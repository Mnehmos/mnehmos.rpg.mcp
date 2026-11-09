import { describe, it, expect, vi } from 'vitest';
import { createShutdown } from '../../src/server/shutdown';

describe('shutdown exit codes', () => {
    const make = (close = vi.fn()) => {
        const exit = vi.fn();
        const shutdown = createShutdown({ close, exit, log: () => {} });
        return { shutdown, exit, close };
    };

    it('exits 0 for a requested stop', () => {
        const { shutdown, exit, close } = make();
        shutdown('SIGTERM');
        expect(close).toHaveBeenCalledTimes(1);
        expect(exit).toHaveBeenCalledWith(0);
    });

    it('exits non-zero for a crash, so the platform restarts the service', () => {
        for (const reason of ['uncaughtException', 'unhandledRejection']) {
            const { shutdown, exit, close } = make();
            shutdown(reason, { crashed: true });
            expect(close).toHaveBeenCalledTimes(1);
            expect(exit).toHaveBeenCalledWith(1);
        }
    });

    it('exits non-zero when closing the databases fails', () => {
        const { shutdown, exit } = make(vi.fn(() => { throw new Error('disk gone'); }));
        shutdown('SIGTERM');
        expect(exit).toHaveBeenCalledWith(1);
    });

    it('runs once even if signalled repeatedly', () => {
        const { shutdown, exit, close } = make();
        shutdown('SIGTERM');
        shutdown('SIGINT');
        expect(close).toHaveBeenCalledTimes(1);
        expect(exit).toHaveBeenCalledTimes(1);
    });
});
