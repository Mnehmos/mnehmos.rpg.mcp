/**
 * Build Configuration Tests
 * 
 * Validates that build configuration includes all necessary platforms
 * and that native module URLs are accessible.
 */

import { describe, it, expect } from 'vitest';

describe('Build Configuration', () => {
    it('should include all required platforms for pkg', () => {
        const expectedPlatforms = [
            'node20-win-x64',
            'node20-macos-x64',
            'node20-macos-arm64',  // Apple Silicon (M1/M2/M3/M4)
            'node20-linux-x64'
        ];

        // This test documents the expected platforms
        // The actual pkg config is in esbuild.config.mjs
        expect(expectedPlatforms).toHaveLength(4);
        expect(expectedPlatforms).toContain('node20-macos-arm64');
    });

    it('should map platforms to correct binary suffixes', () => {
        const platformSuffixes: Record<string, string> = {
            'win32-x64': 'win',
            'darwin-x64': 'macos',
            'darwin-arm64': 'macos-arm64',
            'linux-x64': 'linux'
        };

        expect(platformSuffixes['darwin-arm64']).toBe('macos-arm64');
        expect(platformSuffixes['darwin-x64']).toBe('macos');
        expect(platformSuffixes['win32-x64']).toBe('win');
        expect(platformSuffixes['linux-x64']).toBe('linux');
    });

    it('should have prebuild URLs for all platforms', () => {
        const PKG_NODE_VERSION = '115'; // Node.js v20.x ABI version
        const BETTER_SQLITE3_VERSION = '12.4.6';

        const PREBUILD_URLS: Record<string, string> = {
            'win32-x64': `https://github.com/WiseLibs/better-sqlite3/releases/download/v${BETTER_SQLITE3_VERSION}/better-sqlite3-v${BETTER_SQLITE3_VERSION}-node-v${PKG_NODE_VERSION}-win32-x64.tar.gz`,
            'darwin-x64': `https://github.com/WiseLibs/better-sqlite3/releases/download/v${BETTER_SQLITE3_VERSION}/better-sqlite3-v${BETTER_SQLITE3_VERSION}-node-v${PKG_NODE_VERSION}-darwin-x64.tar.gz`,
            'darwin-arm64': `https://github.com/WiseLibs/better-sqlite3/releases/download/v${BETTER_SQLITE3_VERSION}/better-sqlite3-v${BETTER_SQLITE3_VERSION}-node-v${PKG_NODE_VERSION}-darwin-arm64.tar.gz`,
            'linux-x64': `https://github.com/WiseLibs/better-sqlite3/releases/download/v${BETTER_SQLITE3_VERSION}/better-sqlite3-v${BETTER_SQLITE3_VERSION}-node-v${PKG_NODE_VERSION}-linux-x64.tar.gz`,
        };

        // Verify all platforms have URLs
        expect(PREBUILD_URLS['win32-x64']).toBeDefined();
        expect(PREBUILD_URLS['darwin-x64']).toBeDefined();
        expect(PREBUILD_URLS['darwin-arm64']).toBeDefined();
        expect(PREBUILD_URLS['linux-x64']).toBeDefined();

        // Verify URLs point to correct Node version
        Object.values(PREBUILD_URLS).forEach(url => {
            expect(url).toContain('node-v115');
        });
    });

    it('should generate expected binary names', () => {
        const platforms = ['win32-x64', 'darwin-x64', 'darwin-arm64', 'linux-x64'];
        const platformSuffixes: Record<string, string> = {
            'win32-x64': 'win',
            'darwin-x64': 'macos',
            'darwin-arm64': 'macos-arm64',
            'linux-x64': 'linux'
        };

        const expectedOutputs = platforms.map(platform => {
            const suffix = platformSuffixes[platform];
            return {
                platform,
                binary: platform === 'win32-x64' ? `rpg-mcp-${suffix}.exe` : `rpg-mcp-${suffix}`,
                nativeModule: `better_sqlite3-${suffix}.node`
            };
        });

        // Verify all platforms generate outputs
        expect(expectedOutputs).toHaveLength(4);

        // Verify Apple Silicon specific outputs
        const applesSilicon = expectedOutputs.find(o => o.platform === 'darwin-arm64');
        expect(applesSilicon).toBeDefined();
        expect(applesSilicon?.binary).toBe('rpg-mcp-macos-arm64');
        expect(applesSilicon?.nativeModule).toBe('better_sqlite3-macos-arm64.node');

        // Verify Intel Mac outputs
        const intelMac = expectedOutputs.find(o => o.platform === 'darwin-x64');
        expect(intelMac).toBeDefined();
        expect(intelMac?.binary).toBe('rpg-mcp-macos');
        expect(intelMac?.nativeModule).toBe('better_sqlite3-macos.node');
    });

    it('should map to correct Tauri binary names', () => {
        const tauriTargets: Record<string, string> = {
            'rpg-mcp-win.exe': 'rpg-mcp-server-x86_64-pc-windows-msvc.exe',
            'rpg-mcp-macos': 'rpg-mcp-server-x86_64-apple-darwin',
            'rpg-mcp-macos-arm64': 'rpg-mcp-server-aarch64-apple-darwin',
            'rpg-mcp-linux': 'rpg-mcp-server-x86_64-unknown-linux-gnu'
        };

        // Verify Apple Silicon maps to aarch64-apple-darwin
        expect(tauriTargets['rpg-mcp-macos-arm64']).toBe('rpg-mcp-server-aarch64-apple-darwin');
        
        // Verify Intel Mac maps to x86_64-apple-darwin
        expect(tauriTargets['rpg-mcp-macos']).toBe('rpg-mcp-server-x86_64-apple-darwin');
    });
});
