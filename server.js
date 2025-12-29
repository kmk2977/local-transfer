const express = require('express');
const multer = require('multer');
const cors = require('cors');
const ip = require('ip');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode'); // New library for data-urls

const os = require('os');

const app = express();
const PORT = 3000;

// Determine writable paths
// When packaged in Electron, __dirname is inside a read-only .asar file.
// We need to move the shared/uploads folders to a writable location.
const isPackaged = __dirname.includes('app.asar');
const writableBase = isPackaged
    ? path.join(os.homedir(), 'LocalTransfer')
    : __dirname;

const SHARED_ROOT = path.join(writableBase, 'shared');
const UPLOAD_TEMP = path.join(writableBase, 'uploads');

// Ensure directories exist
[SHARED_ROOT, UPLOAD_TEMP].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Middleware
app.use(cors());
// Use absolute path for public folder
app.use(express.static(path.join(__dirname, 'public')));

// Multer setup for uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOAD_TEMP);
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname); // Keep original name
    }
});

const upload = multer({ storage: storage });

const getDirSize = async (dirPath) => {
    try {
        const files = await fs.promises.readdir(dirPath, { withFileTypes: true });
        const sizes = await Promise.all(files.map(async file => {
            const filePath = path.join(dirPath, file.name);
            if (file.isDirectory()) {
                return await getDirSize(filePath);
            } else {
                const stats = await fs.promises.stat(filePath);
                return stats.size;
            }
        }));
        return sizes.reduce((acc, size) => acc + size, 0);
    } catch (e) {
        return 0;
    }
};

// Routes

// Performance Tracking
let activeTransfers = 0;

// 0. High-Performance Download (The "Turbo" implementation)
app.get('/api/download', (req, res) => {
    const reqPath = req.query.path;
    if (!reqPath) return res.status(400).send('No file specified');

    const safePath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
    const absolutePath = path.join(SHARED_ROOT, safePath);

    if (!absolutePath.startsWith(SHARED_ROOT)) {
        return res.status(403).send('Access denied');
    }

    try {
        const stats = fs.statSync(absolutePath);
        const fileName = path.basename(absolutePath);

        // Disable Nagle's algorithm for zero-latency streaming
        if (res.socket) res.socket.setNoDelay(true);

        activeTransfers++;

        // Raw headers for maximum throughput
        res.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Length': stats.size,
            'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
            'Cache-Control': 'public, max-age=3600',
            'Connection': 'keep-alive',
            'X-Content-Type-Options': 'nosniff'
        });

        // 1MB buffers for big files
        const readStream = fs.createReadStream(absolutePath, {
            highWaterMark: 1024 * 1024
        });

        // Directly pipe to response
        readStream.pipe(res);

        const cleanup = () => {
            activeTransfers = Math.max(0, activeTransfers - 1);
        };

        res.on('finish', cleanup);
        res.on('close', cleanup);

        readStream.on('error', (err) => {
            cleanup();
            console.error('Stream error:', err);
            if (!res.headersSent) res.status(500).send('Stream error');
        });
    } catch (err) {
        res.status(404).send('File not found');
    }
});

// 1. List files (with navigation and stats)
const sizeCache = new Map();

app.get('/api/files', async (req, res) => {
    const reqPath = req.query.path || '';
    // Prevent directory traversal attacks
    const safePath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
    const absolutePath = path.join(SHARED_ROOT, safePath);

    if (!absolutePath.startsWith(SHARED_ROOT)) {
        return res.status(403).json({ error: 'Access denied' });
    }

    fs.readdir(absolutePath, { withFileTypes: true }, async (err, files) => {
        if (err) {
            return res.status(500).json({ error: 'Unable to scan directory' });
        }

        // Get stats for sorting AND recursive info
        const fileList = await Promise.all(files.map(async dirent => {
            const fullPath = path.join(absolutePath, dirent.name);
            let stats;
            let realSize = 0;

            try {
                stats = await fs.promises.stat(fullPath);
                if (dirent.isDirectory()) {
                    // PERFORMANCE: If we are downloading, don't walk the disk for folder sizes
                    if (activeTransfers > 0) {
                        const cached = sizeCache.get(fullPath);
                        realSize = cached ? cached.size : 0;
                    } else {
                        const cacheKey = fullPath;
                        const cached = sizeCache.get(cacheKey);
                        if (cached && (Date.now() - cached.time < 60000)) { // 1 min cache
                            realSize = cached.size;
                        } else {
                            realSize = await getDirSize(fullPath);
                            sizeCache.set(cacheKey, { size: realSize, time: Date.now() });
                        }
                    }
                } else {
                    realSize = stats.size;
                }
            } catch (e) {
                stats = { mtime: 0, size: 0 };
            }

            return {
                name: dirent.name,
                isDirectory: dirent.isDirectory(),
                path: path.join(reqPath, dirent.name),
                mtime: stats.mtime,
                size: realSize
            };
        }));

        res.json({ path: reqPath, files: fileList });
    });
});

// 2. Upload File
app.post('/api/upload', upload.array('files'), async (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).send('No files uploaded.');
    }

    const uploadPath = req.body.path || '';
    const safeUploadPath = path.normalize(uploadPath).replace(/^(\.\.[\/\\])+/, '');
    const currentPath = path.join(SHARED_ROOT, safeUploadPath);

    if (!currentPath.startsWith(SHARED_ROOT)) {
        return res.status(403).send('Access denied');
    }

    try {
        // Use Promise.all to ensure all renames complete before responding
        await Promise.all(req.files.map(async (file) => {
            let originalName = file.originalname.replace(/@@@/g, '/');
            originalName = originalName.replace(/^\/+|\/+$/g, '');

            const targetPath = path.join(currentPath, originalName);
            const parentDir = path.dirname(targetPath);

            if (!parentDir.startsWith(SHARED_ROOT)) return;

            if (!fs.existsSync(parentDir)) {
                fs.mkdirSync(parentDir, { recursive: true });
            }

            const sourcePath = file.path;
            await fs.promises.rename(sourcePath, targetPath);
        }));

        res.json({ message: 'Files uploaded successfully!' });
    } catch (err) {
        console.error('Upload processing error:', err);
        res.status(500).send('Error processing uploads');
    }
});

// 4. Download Folder (Zip)
app.get('/api/download-zip', (req, res) => {
    const reqPath = req.query.path;
    if (!reqPath) return res.status(400).send('No folder specified');

    const safePath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
    const absolutePath = path.join(SHARED_ROOT, safePath);

    if (!absolutePath.startsWith(SHARED_ROOT)) {
        return res.status(403).send('Access denied');
    }

    const archive = archiver('zip', {
        zlib: { level: 9 } // Sets the compression level.
    });

    archive.on('error', function (err) {
        res.status(500).send({ error: err.message });
    });

    res.attachment(path.basename(safePath) + '.zip');
    archive.pipe(res);
    archive.directory(absolutePath, false);
    archive.finalize();
});

// 5. Delete File
app.delete('/api/files', (req, res) => {
    const reqPath = req.query.path;
    if (!reqPath) return res.status(400).send('No file specified');

    const safePath = path.normalize(reqPath).replace(/^(\.\.[\/\\])+/, '');
    const absolutePath = path.join(SHARED_ROOT, safePath);

    if (!absolutePath.startsWith(SHARED_ROOT)) {
        return res.status(403).send('Access denied');
    }

    fs.rm(absolutePath, { recursive: true, force: true }, (err) => {
        if (err) {
            console.error(err);
            return res.status(500).send('Error deleting file');
        }
        res.send('File deleted');
    });
});

// 6. Shutdown Server
app.post('/api/shutdown', (req, res) => {
    res.json({ message: 'Server is shutting down...' });
    console.log('Received shutdown signal from client.');
    setTimeout(() => {
        console.log('Shutting down now.');
        process.exit(0);
    }, 1000);
});

// 7. Get Server Info (for QR Code and IP display)
app.get('/api/info', async (req, res) => {
    const ipAddress = ip.address();
    const port = req.socket.localPort || PORT;
    const url = `http://${ipAddress}:${port}`;

    try {
        const qrDataUrl = await QRCode.toDataURL(url);
        res.json({
            url: url,
            ip: ipAddress,
            port: port,
            qrCode: qrDataUrl
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to generate QR code' });
    }
});


const EventEmitter = require('events');
const serverEvents = new EventEmitter();

// Start Server
const startServer = (port) => {
    const server = app.listen(port, '0.0.0.0', () => {
        const ipAddress = ip.address();
        const url = `http://${ipAddress}:${port}`;
        const localUrl = `http://localhost:${port}`;

        console.log('---------------------------------------------------');
        console.log(`Server started!`);
        console.log(`Scan this QR Code to connect:`);
        qrcodeTerminal.generate(url, { small: true });
        console.log(`Or visit: ${url}`);
        console.log('---------------------------------------------------');
        console.log(`Shared Folder: ${SHARED_ROOT}`);
        console.log('Files put in "shared" folder will appear on your phone.');
        console.log('---------------------------------------------------');

        serverEvents.emit('started', { url, localUrl, port });
    });

    server.on('error', (e) => {
        if (e.code === 'EADDRINUSE') {
            console.log(`Port ${port} is in use, trying ${port + 1}...`);
            startServer(port + 1);
        } else {
            console.error("Server Error:", e);
        }
    });
};

// Export app and a way to know when it's ready
module.exports = {
    app,
    start: startServer,
    events: serverEvents
};

// Start the server if this file is run directly
if (require.main === module) {
    startServer(PORT);
}

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
