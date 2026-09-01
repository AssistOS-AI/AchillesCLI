import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
    assertSafeAchillesPrivatePath,
    ensureAchillesPrivateDataRoot,
    resolveAchillesPrivateDataRoot,
} from '../lib/privateDataRoot.mjs';

const HISTORY_FILENAME = 'history';
const DEFAULT_MAX_ENTRIES = 1000;

/**
 * HistoryManager - Manages persistent command history for the CLI.
 *
 * Stores command history in a file within the working directory,
 * providing per-project history isolation.
 */
export class HistoryManager {
    constructor({
        workingDir = process.cwd(),
        maxEntries = DEFAULT_MAX_ENTRIES,
    } = {}) {
        this.workingDir = path.resolve(workingDir);
        this.achillesCliDir = resolveAchillesPrivateDataRoot(this.workingDir);
        this.historyPath = assertSafeAchillesPrivatePath(this.workingDir, HISTORY_FILENAME, {
            label: 'AchillesCLI history file',
            type: 'file',
        });
        this.maxEntries = maxEntries;
        this.history = [];
        this.currentIndex = -1;

        this._load();
    }

    /**
     * Load history from file
     */
    _load() {
        try {
            if (fs.existsSync(this.historyPath)) {
                const content = fs.readFileSync(this.historyPath, 'utf-8');
                this.history = content
                    .split('\n')
                    .filter(line => line.trim() !== '');

                // Trim to max entries if needed
                if (this.history.length > this.maxEntries) {
                    this.history = this.history.slice(-this.maxEntries);
                    this._save();
                }
            }
        } catch (error) {
            if (error?.code === 'ACHILLES_PRIVATE_PATH_UNSAFE') throw error;
            // Silently ignore read errors, start with empty history
            this.history = [];
        }
    }

    /**
     * Save history to file
     */
    _save() {
        try {
            ensureAchillesPrivateDataRoot(this.workingDir);
            assertSafeAchillesPrivatePath(this.workingDir, HISTORY_FILENAME, {
                label: 'AchillesCLI history file',
                type: 'file',
            });
            const temporaryPath = `${this.historyPath}.${process.pid}.${randomUUID()}.tmp`;
            try {
                fs.writeFileSync(temporaryPath, this.history.join('\n') + '\n', {
                    encoding: 'utf8',
                    mode: 0o600,
                    flag: 'wx',
                });
                assertSafeAchillesPrivatePath(this.workingDir, HISTORY_FILENAME, {
                    label: 'AchillesCLI history file',
                    type: 'file',
                });
                fs.renameSync(temporaryPath, this.historyPath);
            } finally {
                try {
                    fs.unlinkSync(temporaryPath);
                } catch (error) {
                    if (error?.code !== 'ENOENT') throw error;
                }
            }
        } catch (error) {
            if (error?.code === 'ACHILLES_PRIVATE_PATH_UNSAFE') throw error;
            // Silently ignore write errors
        }
    }

    /**
     * Add a command to history
     * @param {string} command - The command to add
     */
    add(command) {
        const trimmed = command.trim();
        if (!trimmed) return;

        // Don't add duplicates of the last command
        if (this.history.length > 0 && this.history[this.history.length - 1] === trimmed) {
            this.resetNavigation();
            return;
        }

        this.history.push(trimmed);

        // Trim if over max
        if (this.history.length > this.maxEntries) {
            this.history = this.history.slice(-this.maxEntries);
        }

        this._save();
        this.resetNavigation();
    }

    /**
     * Get a command by index (0 = oldest, length-1 = newest)
     * @param {number} index
     * @returns {string|null}
     */
    get(index) {
        if (index < 0 || index >= this.history.length) {
            return null;
        }
        return this.history[index];
    }

    /**
     * Get the previous command (for up arrow navigation)
     * @returns {string|null}
     */
    getPrevious() {
        if (this.history.length === 0) return null;

        if (this.currentIndex === -1) {
            // Start from the end
            this.currentIndex = this.history.length - 1;
        } else if (this.currentIndex > 0) {
            this.currentIndex--;
        }

        return this.history[this.currentIndex];
    }

    /**
     * Get the next command (for down arrow navigation)
     * @returns {string|null} Returns null when at the end (new input position)
     */
    getNext() {
        if (this.currentIndex === -1) return null;

        if (this.currentIndex < this.history.length - 1) {
            this.currentIndex++;
            return this.history[this.currentIndex];
        } else {
            // At the end, reset to new input position
            this.currentIndex = -1;
            return null;
        }
    }

    /**
     * Reset navigation position (call when user enters a new command)
     */
    resetNavigation() {
        this.currentIndex = -1;
    }

    /**
     * Get recent commands
     * @param {number} count - Number of recent commands to return
     * @returns {Array<{index: number, command: string}>}
     */
    getRecent(count = 10) {
        const start = Math.max(0, this.history.length - count);
        return this.history.slice(start).map((command, i) => ({
            index: start + i + 1, // 1-based for display
            command,
        }));
    }

    /**
     * Search history for commands containing a string
     * @param {string} query - Search string
     * @param {number} limit - Max results
     * @returns {Array<{index: number, command: string}>}
     */
    search(query, limit = 10) {
        const lowerQuery = query.toLowerCase();
        const results = [];

        // Search from newest to oldest
        for (let i = this.history.length - 1; i >= 0 && results.length < limit; i--) {
            if (this.history[i].toLowerCase().includes(lowerQuery)) {
                results.push({
                    index: i + 1, // 1-based for display
                    command: this.history[i],
                });
            }
        }

        return results;
    }

    /**
     * Get all history entries
     * @returns {string[]}
     */
    getAll() {
        return [...this.history];
    }

    /**
     * Get count of history entries
     * @returns {number}
     */
    get length() {
        return this.history.length;
    }

    /**
     * Clear all history
     */
    clear() {
        this.history = [];
        this.currentIndex = -1;
        this._save();
    }

    /**
     * Get the path to the history file
     * @returns {string}
     */
    getHistoryPath() {
        return this.historyPath;
    }
}

export default HistoryManager;
