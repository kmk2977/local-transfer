# Local File Transfer Setup Guide

This guide will help you install the necessary dependencies and manage the Local Transfer server on your macOS machine.

## Prerequisites

You need **Node.js** to run this server. We will use **Homebrew** (a package manager for macOS) to install it.

### 1. Install Homebrew (if not already installed)
Open your Terminal and run:
` /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`

### 2. Install Node.js
Run the following command in Terminal to install the latest version of Node.js:
`brew install node`

Verify the installation:
`node -v`
`npm -v`

## Project Setup

Navigate to your project folder in the Terminal. If you are not already there:
`cd /path/to/local_transfer`

Install the project dependencies. This command automatically downloads and installs all the required libraries for the server (Express, Multer, Archiver, QRCode, etc.) into the `node_modules` folder:
`npm install`

## How to Start the Server

1. Open Terminal.
2. Navigate to the project folder:
   `cd ~/Desktop/local_transfer`
   *(Adjust the path if you saved it elsewhere)*
3. Run the start command:
   `node server.js`

You will see a **QR Code** in the terminal. Scan it with your phone to connect!

## How to Stop the Server

**Option A (Recommended):**
Click the **Power / Shutdown button** in the top-right corner of the web interface on your phone or computer. This safely shuts down the server.

**Option B (Terminal):**
Press `Ctrl + C` in the terminal window where the server is running.

## NEW: Launch as a macOS App!
I have bundled the project into a standalone macOS Application so you don't have to use the Terminal.

1.  Open the folder: `~/Desktop/local_transfer/dist/mac-arm64`
2.  Find **Local Transfer.app**.
3.  **To Launch:** Right-click the app and select **Open** (you only need to do this the first time).
4.  The app will sit in your Dock and work exactly like the terminal version, but with its own window!

*Tip: When using the App, your shared files are now located in your home folder at: `~/LocalTransfer/shared` (to keep them safe and separate from the app itself).*

## ☁️ Cloud Distribution (Pro Method)

If you want to delete this folder and just install the app via a single terminal command on any Mac:

### 1. Build the Zip
Run `npm run build`. This will create a `Local Transfer-1.0.0-mac.zip` inside the `dist` folder.

### 2. Upload to GitHub
- Create a new GitHub repository called `local-transfer`.
- Go to **Releases** -> **Draft a new release**.
- Upload the `.zip` file from your `dist` folder.
- Also upload the `install.sh` file to the main code branch.

### 3. The "One-Liner" Install Command
Once uploaded, you can install the app on **ANY Mac** using this command:
```bash
curl -sSL https://raw.githubusercontent.com/YOUR_USERNAME/local-transfer/main/install.sh | bash
```
*(Replace `YOUR_USERNAME` with your real GitHub username)*

This command will automatically download the app, move it to `/Applications`, and clean up everything!

## Troubleshooting

- **"Port already in use"**: The server will automatically try the next available port (e.g., 3001, 3002). Just scan the new QR code generated.
- **Connection Issues**: Ensure your phone and computer are connected to the **same Wi-Fi network**.
