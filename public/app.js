const fileListEl = document.getElementById('fileList');
const fileInput = document.getElementById('fileInput');
const dropZone = document.getElementById('dropZone');
const breadcrumbEl = document.getElementById('breadcrumb');
const refreshBtn = document.getElementById('refreshBtn');
const shutdownBtn = document.getElementById('shutdownBtn');

// Shutdown Handler
shutdownBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to stop the server? The connection will be lost.')) {
        try {
            await fetch('/api/shutdown', { method: 'POST' });
            document.body.innerHTML = `
                <div style="display:flex; justify-content:center; align-items:center; height:100vh; flex-direction:column; text-align:center;">
                    <h1 style="color: #ef4444;">Server Stopped</h1>
                    <p>You can close this tab now.</p>
                </div>
            `;
        } catch (e) {
            alert('Could not contact server (it might already be stopped).');
        }
    }
});

// Progress Elements
const progressContainer = document.getElementById('progressContainer');
const progressBar = document.getElementById('progressBar');
const progressText = document.getElementById('progressText');
const progressPercent = document.getElementById('progressPercent');
const progressEta = document.getElementById('progressEta');

let currentPath = '';

const connectBtn = document.getElementById('connectBtn');
const qrModal = document.getElementById('qrModal');
const closeQr = document.getElementById('closeQr');
const qrImage = document.getElementById('qrImage');
const serverUrlText = document.getElementById('serverUrlText');

// Load Server Info (URL/QR)
async function loadServerInfo() {
    try {
        const res = await fetch('/api/info');
        const data = await res.json();
        if (data.qrCode) {
            qrImage.src = data.qrCode;
            serverUrlText.innerText = data.url;
        }
    } catch (e) {
        console.error('Failed to load server info');
    }
}

connectBtn.addEventListener('click', () => {
    loadServerInfo();
    qrModal.style.display = 'flex';
});

closeQr.addEventListener('click', () => {
    qrModal.style.display = 'none';
});

// Close modal when clicking outside
window.addEventListener('click', (e) => {
    if (e.target === qrModal) {
        qrModal.style.display = 'none';
    }
});

// Initialize
loadFiles('');
loadServerInfo();

// Refresh Button
refreshBtn.addEventListener('click', () => loadFiles(currentPath));

// File Input Change
fileInput.addEventListener('change', handleUpload);

// Drop Zone Events
dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');

    const items = e.dataTransfer.items;
    if (items) {
        // Use DataTransferItemList interface to access file(s)
        const files = [];
        const queue = [];

        for (let i = 0; i < items.length; i++) {
            const entry = items[i].webkitGetAsEntry ? items[i].webkitGetAsEntry() : null;
            if (entry) {
                queue.push(traverseFileTree(entry));
            } else if (items[i].kind === 'file') {
                files.push(items[i].getAsFile());
            }
        }

        // Wait for all traversals
        const nestedFilesArray = await Promise.all(queue);
        // Flatten
        nestedFilesArray.forEach(subFiles => files.push(...subFiles));

        if (files.length > 0) {
            uploadFiles(files);
        }
    } else if (e.dataTransfer.files.length) {
        // Fallback
        uploadFiles(e.dataTransfer.files);
    }
});

// Helper to traverse directories
function traverseFileTree(item, path = '') {
    return new Promise((resolve) => {
        if (item.isFile) {
            item.file(file => {
                // Monkey-patch the path into the file object so we can read it later
                // We'll use a custom property since we can't easily overwrite webkitRelativePath
                file.fullPath = path + file.name;
                resolve([file]);
            });
        } else if (item.isDirectory) {
            const dirReader = item.createReader();
            const entries = [];

            const readEntries = () => {
                dirReader.readEntries(async (result) => {
                    if (result.length === 0) {
                        // Done reading directory
                        const promises = entries.map(entry => traverseFileTree(entry, path + item.name + '/'));
                        const results = await Promise.all(promises);
                        resolve(results.flat());
                    } else {
                        entries.push(...result);
                        readEntries(); // Continue reading (readEntries returns blocks)
                    }
                });
            };
            readEntries();
        }
    });
}

const folderInput = document.getElementById('folderInput');
folderInput.addEventListener('change', handleUpload);

function handleUpload(e) {
    // Works for both fileInput and folderInput
    const files = e.target.files;
    if (files && files.length > 0) {
        uploadFiles(files);
    }
}

function uploadFiles(files) {
    const formData = new FormData();

    // Add destination path
    formData.append('path', currentPath);

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        let filename = file.name;
        if (file.fullPath) {
            filename = file.fullPath;
        } else if (file.webkitRelativePath) {
            filename = file.webkitRelativePath;
        }

        // HACK: Replace slashes with a special sequence because paths are often stripped
        const safeName = filename.replace(/\//g, '@@@');
        formData.append('files', file, safeName);
    }

    const progressStats = document.getElementById('progressStats');

    // Reset and Show Progress UI
    progressContainer.style.display = 'block';
    progressBar.style.width = '0%';
    progressPercent.innerText = '0%';
    progressStats.innerText = '';
    progressEta.innerText = 'ETA: Calculating...';

    const xhr = new XMLHttpRequest();
    const startTime = Date.now();

    let lastUiUpdate = 0;

    xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
            const now = Date.now();
            // High-speed optimization: throttle UI to 300ms
            if (now - lastUiUpdate < 300 && e.loaded !== e.total) {
                return;
            }
            lastUiUpdate = now;

            const percent = (e.loaded / e.total) * 100;
            progressBar.style.width = percent + '%';
            progressPercent.innerText = Math.round(percent) + '%';
            progressStats.innerText = `${formatSize(e.loaded)} / ${formatSize(e.total)}`;

            const timeElapsed = (now - startTime) / 1000;
            const uploadSpeed = e.loaded / timeElapsed; // bytes/sec

            if (uploadSpeed > 0 && percent < 100) {
                const remainingBytes = e.total - e.loaded;
                const etaSeconds = remainingBytes / uploadSpeed;
                const speedMB = (uploadSpeed / (1024 * 1024)).toFixed(1);
                progressEta.innerText = `ETA: ${formatTime(etaSeconds)} (${speedMB} MB/s)`;
            } else if (percent >= 100) {
                progressEta.innerText = 'Finishing up...';
            }
        }
    });

    xhr.open('POST', '/api/upload');

    xhr.onreadystatechange = function () {
        if (xhr.readyState === 4) {
            progressContainer.style.display = 'none'; // Hide progress bar
            if (xhr.status === 200) {
                loadFiles(currentPath); // Refresh list
            } else {
                alert('Upload failed');
            }
        }
    };

    xhr.onerror = function () {
        alert('Error uploading files');
        progressContainer.style.display = 'none';
    };

    xhr.send(formData);
}

function formatTime(seconds) {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}m ${secs}s`;
}

async function loadFiles(path) {
    currentPath = path;
    updateBreadcrumb(path);

    fileListEl.innerHTML = '<li style="text-align: center; color: var(--text-muted);">Loading...</li>';

    try {
        const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
        const data = await res.json();

        renderFiles(data.files);
    } catch (err) {
        fileListEl.innerHTML = '<li style="text-align: center; color: #ef4444;">Error loading files</li>';
    }
}

function renderFiles(files) {
    fileListEl.innerHTML = '';

    if (files.length === 0) {
        fileListEl.innerHTML = '<li style="text-align: center; color: var(--text-muted); padding: 20px;">Folder is empty</li>';
        return;
    }

    // Sort: Folders first, then Newest First (by mtime)
    files.sort((a, b) => {
        if (a.isDirectory === b.isDirectory) {
            // Sort by Date Modified (Desc)
            // mtime might be string or date object
            const timeA = new Date(a.mtime || 0);
            const timeB = new Date(b.mtime || 0);
            return timeB - timeA;
        }
        return a.isDirectory ? -1 : 1;
    });

    files.forEach(file => {
        const li = document.createElement('li');
        li.className = 'file-item';

        const iconName = file.isDirectory ? 'folder' : 'document-text';
        const iconColor = file.isDirectory ? '#fbbf24' : '#94a3b8'; // Amber for folders

        // Action: Navigate (folder) or Download (file)
        const escapedPath = file.path.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const clickAction = file.isDirectory
            ? `onclick="loadFiles('${escapedPath}')"`
            : '';

        // Download Link
        let downloadUrl = '';
        let downloadIcon = '';

        if (file.isDirectory) {
            // Zip download for folders
            downloadUrl = `/api/download-zip?path=${encodeURIComponent(file.path)}`;
            downloadIcon = 'cloud-download-outline';
        } else {
            // Direct download for files
            downloadUrl = `/api/download?path=${encodeURIComponent(file.path)}`;
            downloadIcon = 'download-outline';
        }

        // Stats Display (Size) - could also show date if needed
        const sizeText = formatSize(file.size);

        li.innerHTML = `
            <div class="file-info" style="cursor: ${file.isDirectory ? 'pointer' : 'default'}" ${clickAction}>
                <div class="file-icon" style="color: ${iconColor}">
                    <ion-icon name="${iconName}"></ion-icon>
                </div>
                <div style="display:flex; flex-direction: column;">
                    <span class="file-name">${file.name}</span>
                    <span style="font-size: 0.75rem; color: var(--text-muted);">${sizeText}</span>
                </div>
            </div>
            <div style="display: flex; gap: 8px;">
                <a href="${downloadUrl}" class="action-btn" title="Download" target="_blank">
                    <ion-icon name="${downloadIcon}"></ion-icon>
                </a>
                <button onclick="deleteFile('${file.path.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')" class="action-btn delete-btn" title="Delete">
                    <ion-icon name="trash-outline"></ion-icon>
                </button>
            </div>
        `;
        fileListEl.appendChild(li);
    });
}

function formatSize(bytes) {
    if (bytes === undefined || bytes === null) return '';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 B';
    const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
    const val = bytes / Math.pow(1024, i);
    return (i === 0 ? val : val.toFixed(2)) + ' ' + sizes[i];
}

async function deleteFile(path) {
    if (!confirm('Are you sure you want to delete this?')) return;

    try {
        const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`, {
            method: 'DELETE'
        });
        if (res.ok) {
            loadFiles(currentPath);
        } else {
            alert('Failed to delete');
        }
    } catch (e) {
        alert('Error deleting file');
    }
}

function updateBreadcrumb(pathStr) {
    if (!pathStr) {
        breadcrumbEl.style.display = 'none';
        return;
    }
    breadcrumbEl.style.display = 'flex';

    const parts = pathStr.split(/[/\\]/).filter(p => p);

    let html = '<span onclick="loadFiles(\'\')">Home</span>';
    let current = '';

    parts.forEach((part, index) => {
        current += (index > 0 ? '/' : '') + part;
        // Escape quotes just in case
        const safeCurrent = current.replace(/'/g, "\\'");
        html += ` <ion-icon name="chevron-forward-outline" style="font-size: 12px; opacity: 0.5"></ion-icon> 
                 <span onclick="loadFiles('${safeCurrent}')">${part}</span>`;
    });

    breadcrumbEl.innerHTML = html;
}
