const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src');
const distDir = path.join(__dirname, 'dist');

// Files and extensions to copy
const extensionsToCopy = ['.html', '.css', '.js', '.ico', '.png', '.jpg', '.jpeg', '.svg'];
const filesToExclude = ['copy-files.js', 'package.json', 'package-lock.json', 'vercel.json', 'tsconfig.json'];

function copyFiles() {
    // Recreate dist directory
    if (fs.existsSync(distDir)) {
        fs.rmSync(distDir, { recursive: true, force: true });
    }
    fs.mkdirSync(distDir);

    // Read src directory
    const files = fs.readdirSync(srcDir);

    files.forEach(file => {
        const fullPath = path.join(srcDir, file);
        const stat = fs.statSync(fullPath);

        if (stat.isFile()) {
            const ext = path.extname(file).toLowerCase();
            if (extensionsToCopy.includes(ext) && !filesToExclude.includes(file)) {
                fs.copyFileSync(fullPath, path.join(distDir, file));
                console.log(`Copied ${file} to dist/`);
            }
        }
    });

    console.log('Build completed: all files copied to dist/');
}

copyFiles();
