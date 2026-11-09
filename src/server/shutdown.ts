/**
 * Process shutdown, with the exit code the platform needs to see.
 *
 * A requested stop (SIGTERM and friends) exits 0. A crash — an uncaught
 * exception or unhandled rejection — exits 1. The distinction is load-bearing:
 * the host restarts the service only on failure, so a crash that exited 0 left
 * the engine down until someone noticed.
 */
export interface ShutdownDeps {
    /** Close every open database. */
    close: () => void;
    exit: (code: number) => void;
    log?: (message: string) => void;
}

export interface ShutdownOptions {
    /** True when shutting down because something went wrong, not because we were asked to. */
    crashed?: boolean;
}

export function createShutdown(deps: ShutdownDeps) {
    const log = deps.log ?? ((message: string) => console.error(message));
    let isShuttingDown = false;

    const shutdown = (reason: string, options: ShutdownOptions = {}): void => {
        if (isShuttingDown) return;
        isShuttingDown = true;

        log(`[Server] Received ${reason}, shutting down...`);

        let code = options.crashed ? 1 : 0;
        try {
            deps.close();
            log('[Server] Shutdown complete');
        } catch (e) {
            log(`[Server] Error during shutdown: ${(e as Error).message}`);
            code = 1;
        }
        deps.exit(code);
    };

    /** True once shutdown has begun. */
    shutdown.started = () => isShuttingDown;
    return shutdown;
}
