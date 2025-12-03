// esbuild.config.mjs
// Build script to bundle rpg-mcp for pkg packaging with native module support
import * as esbuild from 'esbuild';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outfile = 'dist-bundle/server.cjs';

// Plugin to handle better-sqlite3 with custom loader that uses nativeBinding option
const betterSqlite3Plugin = {
    name: 'better-sqlite3-loader',
    setup(build) {
        // Intercept imports of better-sqlite3
        build.onResolve({ filter: /^better-sqlite3$/ }, args => {
            return {
                path: 'better-sqlite3',
                namespace: 'better-sqlite3-shim'
            };
        });
        
        // Provide custom implementation that loads the real better-sqlite3 with nativeBinding option
        build.onLoad({ filter: /.*/, namespace: 'better-sqlite3-shim' }, () => {
            return {
                contents: `
const path = require('path');
const fs = require('fs');

// Get the directory where the executable is located
function getExeDir() {
    if (process.pkg) {
        return path.dirname(process.execPath);
    }
    return process.cwd();
}

// Find the native module
function findNativeModule() {
    const exeDir = getExeDir();
    const possiblePaths = [
        path.join(exeDir, 'better_sqlite3.node'),
        // Development fallback
        path.join(process.cwd(), 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'),
    ];
    
    for (const p of possiblePaths) {
        try {
            if (fs.existsSync(p)) {
                console.error('[SQLite] Found native module at:', p);
                return p;
            }
        } catch (e) {}
    }
    
    throw new Error('Could not find better_sqlite3.node. Searched in: ' + possiblePaths.join(', '));
}

// Error class for SQLite errors
class SqliteError extends Error {
    constructor(message, code) {
        super(message);
        this.name = 'SqliteError';
        this.code = code;
    }
}

// Load the native binding
const nativePath = findNativeModule();
const addon = require(nativePath);

// Initialize the addon
if (!addon.isInitialized) {
    addon.setErrorConstructor(SqliteError);
    addon.isInitialized = true;
}

// Utility to get boolean option
function getBooleanOption(options, key) {
    let value = false;
    if (key in options && typeof (value = options[key]) !== 'boolean') {
        throw new TypeError('Expected the "' + key + '" option to be a boolean');
    }
    return value;
}

// Symbol for internal cppdb reference
const cppdb = Symbol('cppdb');

// Database wrapper class
function Database(filenameGiven, options) {
    if (new.target == null) {
        return new Database(filenameGiven, options);
    }

    // Apply defaults
    let buffer = null;
    if (Buffer.isBuffer(filenameGiven)) {
        buffer = filenameGiven;
        filenameGiven = ':memory:';
    }
    if (filenameGiven == null) filenameGiven = '';
    if (options == null) options = {};

    // Validate arguments
    if (typeof filenameGiven !== 'string') {
        throw new TypeError('Expected first argument to be a string');
    }
    if (typeof options !== 'object') {
        throw new TypeError('Expected second argument to be an options object');
    }

    // Interpret options
    const filename = filenameGiven.trim();
    const anonymous = filename === '' || filename === ':memory:';
    const readonly = getBooleanOption(options, 'readonly');
    const fileMustExist = getBooleanOption(options, 'fileMustExist');
    const timeout = 'timeout' in options ? options.timeout : 5000;
    const verbose = 'verbose' in options ? options.verbose : null;

    // Validate interpreted options
    if (readonly && anonymous && !buffer) {
        throw new TypeError('In-memory/temporary databases cannot be readonly');
    }
    if (!Number.isInteger(timeout) || timeout < 0) {
        throw new TypeError('Expected the "timeout" option to be a positive integer');
    }
    if (timeout > 0x7fffffff) {
        throw new RangeError('Option "timeout" cannot be greater than 2147483647');
    }
    if (verbose != null && typeof verbose !== 'function') {
        throw new TypeError('Expected the "verbose" option to be a function');
    }

    // Make sure the specified directory exists
    if (!anonymous && !filename.startsWith('file:')) {
        const dir = path.dirname(filename);
        if (dir && dir !== '.' && !fs.existsSync(dir)) {
            throw new TypeError('Cannot open database because the directory does not exist');
        }
    }

    // Create the database - native addon expects these exact arguments
    const db = new addon.Database(
        filename,           // 1: processed filename (trimmed)
        filenameGiven,      // 2: original filename string
        anonymous,          // 3: boolean
        readonly,           // 4: boolean
        fileMustExist,      // 5: boolean
        timeout,            // 6: integer
        verbose || null,    // 7: function or null
        buffer || null      // 8: Buffer or null
    );
    
    Object.defineProperty(this, cppdb, { value: db });
}

// Methods
Database.prototype.prepare = function(sql) {
    return this[cppdb].prepare(sql, this, false);
};

Database.prototype.exec = function(sql) {
    this[cppdb].exec(sql);
    return this;
};

Database.prototype.pragma = function(source, options) {
    if (options == null) options = {};
    if (typeof source !== 'string') throw new TypeError('Expected first argument to be a string');
    if (typeof options !== 'object') throw new TypeError('Expected second argument to be an options object');
    const simple = getBooleanOption(options, 'simple');
    const stmt = this[cppdb].prepare('PRAGMA ' + source, this, true);
    return simple ? stmt.pluck().get() : stmt.all();
};

Database.prototype.close = function() {
    this[cppdb].close();
    return this;
};

Database.prototype.transaction = function(fn) {
    if (typeof fn !== 'function') throw new TypeError('Expected first argument to be a function');
    const db = this;
    const begin = db.prepare('BEGIN');
    const commit = db.prepare('COMMIT');
    const rollback = db.prepare('ROLLBACK');
    
    function transaction(...args) {
        begin.run();
        try {
            const result = fn.apply(this, args);
            commit.run();
            return result;
        } catch (err) {
            rollback.run();
            throw err;
        }
    }
    
    transaction.deferred = transaction;
    transaction.immediate = function(...args) {
        db.exec('BEGIN IMMEDIATE');
        try {
            const result = fn.apply(this, args);
            commit.run();
            return result;
        } catch (err) {
            rollback.run();
            throw err;
        }
    };
    transaction.exclusive = function(...args) {
        db.exec('BEGIN EXCLUSIVE');
        try {
            const result = fn.apply(this, args);
            commit.run();
            return result;
        } catch (err) {
            rollback.run();
            throw err;
        }
    };
    
    return transaction;
};

Database.prototype.defaultSafeIntegers = function(toggle) {
    this[cppdb].defaultSafeIntegers(toggle);
    return this;
};

Database.prototype.unsafeMode = function(toggle) {
    this[cppdb].unsafeMode(toggle);
    return this;
};

Database.prototype.loadExtension = function(...args) {
    this[cppdb].loadExtension(...args);
    return this;
};

// Getters
Object.defineProperty(Database.prototype, 'open', {
    get: function() { return this[cppdb].open; },
    enumerable: true
});
Object.defineProperty(Database.prototype, 'inTransaction', {
    get: function() { return this[cppdb].inTransaction; },
    enumerable: true
});
Object.defineProperty(Database.prototype, 'name', {
    get: function() { return this[cppdb].name; },
    enumerable: true
});
Object.defineProperty(Database.prototype, 'memory', {
    get: function() { return this[cppdb].memory; },
    enumerable: true
});
Object.defineProperty(Database.prototype, 'readonly', {
    get: function() { return this[cppdb].readonly; },
    enumerable: true
});

// Export
module.exports = Database;
module.exports.default = Database;
module.exports.Database = Database;
module.exports.SqliteError = SqliteError;
`,
                loader: 'js'
            };
        });
    }
};

async function build() {
    console.log('🔨 Building rpg-mcp bundle...');
    
    // Ensure output directory exists
    if (!fs.existsSync('dist-bundle')) {
        fs.mkdirSync('dist-bundle', { recursive: true });
    }
    
    // Ensure bin directory exists
    if (!fs.existsSync('bin')) {
        fs.mkdirSync('bin', { recursive: true });
    }
    
    try {
        // Bundle with esbuild
        await esbuild.build({
            entryPoints: ['dist/server/index.js'],
            bundle: true,
            platform: 'node',
            target: 'node20',
            format: 'cjs',
            outfile,
            plugins: [betterSqlite3Plugin],
            minify: false,
            sourcemap: false,
        });
        
        console.log('✅ Bundle created:', outfile);
        
        // Create pkg config
        const bundlePackage = {
            "name": "rpg-mcp-bundle",
            "version": "1.0.0",
            "main": "server.cjs",
            "bin": "server.cjs",
            "pkg": {
                "scripts": [],
                "assets": [],
                "targets": ["node20-win-x64", "node20-macos-x64", "node20-linux-x64"],
                "outputPath": "../bin"
            }
        };
        
        fs.writeFileSync('dist-bundle/package.json', JSON.stringify(bundlePackage, null, 2));
        console.log('✅ Bundle package.json created');
        
        // Now run pkg
        console.log('📦 Creating executables with pkg...');
        execSync('npx pkg dist-bundle/server.cjs --targets node20-win-x64,node20-macos-x64,node20-linux-x64 --output bin/rpg-mcp', {
            stdio: 'inherit',
            cwd: process.cwd()
        });
        
        console.log('✅ Binaries created in bin/');
        
        // Copy native module to bin
        const srcNative = path.join(__dirname, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
        const dstNative = path.join(__dirname, 'bin', 'better_sqlite3.node');
        if (fs.existsSync(srcNative)) {
            fs.copyFileSync(srcNative, dstNative);
            console.log('✅ Native module copied to bin/');
        } else {
            console.warn('⚠️  Native module not found at:', srcNative);
        }
        
        console.log('');
        console.log('🎉 Build complete! Files in bin/:');
        console.log('   - rpg-mcp-win.exe');
        console.log('   - rpg-mcp-macos');
        console.log('   - rpg-mcp-linux');
        console.log('   - better_sqlite3.node (required for all platforms)');
        console.log('');
        console.log('📦 For Tauri deployment, copy both the exe and .node file to src-tauri/binaries/');
        
    } catch (error) {
        console.error('❌ Build failed:', error);
        process.exit(1);
    }
}

build();
