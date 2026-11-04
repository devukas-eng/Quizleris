const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src');
const distDir = path.join(__dirname, 'dist');

// Files and extensions to copy
const extensionsToCopy = ['.html', '.css', '.js', '.ico', '.png', '.jpg', '.jpeg', '.svg'];
const filesToExclude = ['copy-files.js', 'package.json', 'package-lock.json', 'vercel.json', 'tsconfig.json'];

// The page that names the stylesheet and the app's script. It is written last, with both
// addresses stamped with a hash of what they load (style.css?v=<hash>). Every deploy changes
// them, so a reload can't get an old copy from the browser or the CDN, and the page never
// names a version that isn't in place yet.
const PAGE = 'index.html';

// Safe to run from several processes at once (the host may run `npm run build` while the
// server's boot-time rebuild runs): files are overwritten in place instead of deleting and
// recreating dist/, which raced with ENOTEMPTY when two runs overlapped.
function replaceFile(tmp, dest) {
    try {
        fs.renameSync(tmp, dest);
    } catch (error) {
        // Windows refuses to rename over a file that a parallel run is replacing at the same
        // moment. That run writes identical content, so dropping ours is fine.
        fs.rmSync(tmp, { force: true });
        if (!fs.existsSync(dest)) throw error;
    }
}

// Writes to a unique temp name, then renames: readers never see a half-written file
function writeFile(file, write) {
    const tmp = path.join(distDir, `.${file}.${process.pid}.tmp`);
    write(tmp);
    replaceFile(tmp, path.join(distDir, file));
}

// Short hash of files as they are served from dist/
function hashOf(files) {
    const hash = crypto.createHash('sha1');
    files.forEach(file => hash.update(file).update(fs.readFileSync(path.join(distDir, file))));
    return hash.digest('hex').slice(0, 10);
}

// The script's hash covers every module, since app.js imports the rest
function stampedPage(files) {
    const css = hashOf(['style.css']);
    const js = hashOf(files.filter(file => file.endsWith('.js')).sort());
    return fs.readFileSync(path.join(srcDir, PAGE), 'utf8')
        .replace(/(["'])style\.css(?:\?v=[^"']*)?\1/g, `$1style.css?v=${css}$1`)
        .replace(/(["'])app\.js(?:\?v=[^"']*)?\1/g, `$1app.js?v=${js}$1`);
}

function copyFiles() {
    fs.mkdirSync(distDir, { recursive: true });

    const wanted = new Set();
    let copied = 0;
    fs.readdirSync(srcDir).forEach(file => {
        const fullPath = path.join(srcDir, file);
        if (!fs.statSync(fullPath).isFile()) return;
        const ext = path.extname(file).toLowerCase();
        if (!extensionsToCopy.includes(ext) || filesToExclude.includes(file)) return;

        wanted.add(file);
        if (file === PAGE) return; // written last, below
        writeFile(file, tmp => fs.copyFileSync(fullPath, tmp));
        copied++;
    });
    if (wanted.has(PAGE)) {
        const page = stampedPage([...wanted]);
        writeFile(PAGE, tmp => fs.writeFileSync(tmp, page));
        copied++;
    }

    // Remove files that no longer exist in src/ (another run may have removed them already),
    // plus temp files left behind by a crashed run. Fresh temp files belong to a parallel run.
    const now = Date.now();
    fs.readdirSync(distDir).forEach(file => {
        if (wanted.has(file)) return;
        const fullPath = path.join(distDir, file);
        try {
            if (file.endsWith('.tmp') && now - fs.statSync(fullPath).mtimeMs < 60 * 1000) return;
            fs.rmSync(fullPath, { recursive: true, force: true });
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
    });

    console.log(`Build completed: ${copied} files copied to dist/`);
}

copyFiles();
