/*
 * Copyright 2026 Kees Verruijt, Harlingen, The Netherlands
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Firebase configuration - Replace with your Firebase project config
// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
    apiKey: "AIzaSyBzRhFeZiZTYpBspnogQQvwyIMRr-I16As",
    authDomain: "futoshiki-helper.firebaseapp.com",
    databaseURL: "https://futoshiki-helper-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "futoshiki-helper",
    storageBucket: "futoshiki-helper.firebasestorage.app",
    messagingSenderId: "1046234502954",
    appId: "1:1046234502954:web:f63ae06c114b70751cb053",
    measurementId: "G-MB65MM4SBE"
};


// Initialize Firebase
let firebaseDb = null;
let firebaseInitialized = false;

try {
    if (typeof firebase !== 'undefined') {
        firebase.initializeApp(firebaseConfig);
        firebaseDb = firebase.database();
        firebaseInitialized = true;
    }
} catch (error) {
    console.warn('Firebase initialization failed:', error);
}

// ========== OFFLINE QUEUE MANAGEMENT ==========
const OFFLINE_QUEUE_KEY = 'futoshiki_offline_queue';

function getOfflineQueue() {
    try {
        const stored = localStorage.getItem(OFFLINE_QUEUE_KEY);
        if (stored) {
            return JSON.parse(stored);
        }
    } catch (error) {
        console.warn('Could not load offline queue:', error);
    }
    return [];
}

function saveOfflineQueue(queue) {
    try {
        localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
    } catch (error) {
        console.warn('Could not save offline queue:', error);
    }
}

function addToOfflineQueue(size, solveTime) {
    const queue = getOfflineQueue();
    queue.push({
        size,
        solveTime,
        timestamp: Date.now()
    });
    saveOfflineQueue(queue);
}

async function syncOfflineQueue() {
    if (!firebaseInitialized || !firebaseDb || !navigator.onLine) {
        return;
    }

    const queue = getOfflineQueue();
    if (queue.length === 0) {
        return;
    }

    // Aggregate updates by size to minimize transactions
    const updatesBySize = new Map();
    for (const item of queue) {
        if (!updatesBySize.has(item.size)) {
            updatesBySize.set(item.size, { completed: 0, totalTime: 0 });
        }
        const stats = updatesBySize.get(item.size);
        stats.completed++;
        stats.totalTime += item.solveTime;
    }

    // Apply aggregated updates
    const failedItems = [];
    for (const [size, stats] of updatesBySize) {
        const statsRef = firebaseDb.ref(`stats/${size}`);
        try {
            await statsRef.transaction((current) => {
                if (current === null) {
                    return { completed: stats.completed, totalTime: stats.totalTime };
                }
                return {
                    completed: (current.completed || 0) + stats.completed,
                    totalTime: (current.totalTime || 0) + stats.totalTime
                };
            });
        } catch (error) {
            console.warn(`Failed to sync stats for size ${size}:`, error);
            // Keep failed items for retry
            for (const item of queue) {
                if (item.size === size) {
                    failedItems.push(item);
                }
            }
        }
    }

    // Save any failed items back to queue, clear successful ones
    saveOfflineQueue(failedItems);

    if (failedItems.length === 0 && queue.length > 0) {
        console.log(`Synced ${queue.length} offline stats to Firebase`);
    }
}

// Sync when coming online
window.addEventListener('online', () => {
    console.log('Back online - syncing offline queue');
    syncOfflineQueue();
});

// Try to sync on page load
document.addEventListener('DOMContentLoaded', () => {
    // Delay sync slightly to ensure Firebase is ready
    setTimeout(syncOfflineQueue, 2000);
});

class FutoshikiGame {
    constructor() {
        this.size = 5;
        this.grid = [];
        this.constraints = [];
        this.autoDigitsEnabled = false;
        this.selectedCell = null;
        this.entryMode = false;
        this.givenCells = new Set();
        this.pendingHint = null; // Stores hint details for two-stage reveal

        this.setupElement = document.getElementById('setup');
        this.controlsElement = document.getElementById('controls');
        this.entryControlsElement = document.getElementById('entry-controls');
        this.gameContainer = document.getElementById('game-container');
        this.gridElement = document.getElementById('grid');
        this.numberPad = document.getElementById('number-pad');
        this.sizeSelect = document.getElementById('size-select');
        this.startBtn = document.getElementById('start-btn');
        this.newGameBtn = document.getElementById('new-game-btn');
        this.autoDigitsBtn = document.getElementById('auto-digits-btn');
        this.hintBtn = document.getElementById('hint-btn');
        this.solvabilityStatus = document.getElementById('solvability-status');
        this.generateEasyBtn = document.getElementById('generate-easy-btn');
        this.generateMediumBtn = document.getElementById('generate-medium-btn');
        this.generateHardBtn = document.getElementById('generate-hard-btn');
        this.entryDoneBtn = document.getElementById('entry-done-btn');
        this.entryCancelBtn = document.getElementById('entry-cancel-btn');
        this.shareBtn = document.getElementById('share-btn');

        // Progress bar elements
        this.generationProgress = document.getElementById('generation-progress');
        this.progressBar = document.getElementById('progress-bar');
        this.progressAttempts = document.getElementById('progress-attempts');
        this.progressTime = document.getElementById('progress-time');
        this.progressBest = document.getElementById('progress-best');
        this.progressBestHints = document.getElementById('progress-best-hints');
        this.useBestBtn = document.getElementById('use-best-btn');
        this.cancelGenerationBtn = document.getElementById('cancel-generation-btn');
        this.generationCancelled = false;
        this.useCurrentBest = false;

        // Web Worker for puzzle generation
        this.generatorWorker = null;
        this.generationStartTime = null;

        // Counter elements
        this.gameCounters = document.getElementById('game-counters');
        this.currentTimeElement = document.getElementById('current-time');
        this.localAvgTimeElement = document.getElementById('local-avg-time');
        this.localCompletedElement = document.getElementById('local-completed');
        this.globalAvgTimeElement = document.getElementById('global-avg-time');
        this.sizeLabelElement = document.getElementById('size-label');

        // Counter state
        this.puzzleStartedCounted = false;
        this.puzzleCompleted = false;
        this.startTime = null;
        this.timerInterval = null;
        this.currentFirebaseUnsubscribe = null;
        this.hintsUsed = 0;
        this.hintPenaltySeconds = 30;

        // Input row elements for candidate mode
        this.inputRow = document.getElementById('input-row');
        this.candidateModeBtn = document.getElementById('candidate-mode-btn');
        this.numberButtonsContainer = document.getElementById('number-buttons');
        this.eraserBtn = document.getElementById('eraser-btn');
        this.candidateMode = false;

        this.bindEvents();
    }

    bindEvents() {
        this.startBtn.addEventListener('click', () => this.startEntryMode());
        this.newGameBtn.addEventListener('click', () => this.showSetup());
        this.autoDigitsBtn.addEventListener('click', () => this.toggleAutoDigits());
        this.hintBtn.addEventListener('click', () => this.showHint());
        this.generateEasyBtn.addEventListener('click', () => this.startPuzzleGeneration('easy'));
        this.generateMediumBtn.addEventListener('click', () => this.startPuzzleGeneration('medium'));
        this.generateHardBtn.addEventListener('click', () => this.startPuzzleGeneration('hard'));
        this.cancelGenerationBtn.addEventListener('click', () => this.cancelGeneration());
        this.useBestBtn.addEventListener('click', () => this.useBestPuzzle());
        this.entryDoneBtn.addEventListener('click', () => this.finishEntry());
        this.entryCancelBtn.addEventListener('click', () => this.showSetup());
        this.shareBtn.addEventListener('click', () => this.sharePuzzle());

        // Input row event bindings
        this.candidateModeBtn.addEventListener('click', () => this.toggleCandidateMode());
        this.eraserBtn.addEventListener('click', () => this.onEraserClick());

        // Check for puzzle in URL on load
        this.restorePuzzleFromURL();
    }

    // ========== COUNTER AND TIMER METHODS ==========

    getLocalStats(size) {
        try {
            const key = `futoshiki_stats_${size}`;
            const stored = localStorage.getItem(key);
            if (stored) {
                return JSON.parse(stored);
            }
        } catch (error) {
            console.warn('Could not load local stats:', error);
        }
        return { completed: 0, totalTime: 0 };
    }

    saveLocalStats(size, stats) {
        try {
            const key = `futoshiki_stats_${size}`;
            localStorage.setItem(key, JSON.stringify(stats));
        } catch (error) {
            console.warn('Could not save local stats:', error);
        }
    }

    formatTime(seconds) {
        if (seconds === null || seconds === undefined || isNaN(seconds)) {
            return '--';
        }
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    startTimer() {
        this.stopTimer();
        this.startTime = Date.now();
        this.updateTimerDisplay();
        this.timerInterval = setInterval(() => this.updateTimerDisplay(), 1000);
    }

    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
    }

    updateTimerDisplay() {
        if (this.startTime && this.currentTimeElement) {
            const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
            const penalty = this.hintsUsed * this.hintPenaltySeconds;
            const total = elapsed + penalty;
            if (penalty > 0) {
                this.currentTimeElement.textContent = `${this.formatTime(total)} (+${penalty}s)`;
            } else {
                this.currentTimeElement.textContent = this.formatTime(total);
            }
        }
    }

    getElapsedSeconds() {
        if (!this.startTime) return 0;
        return Math.floor((Date.now() - this.startTime) / 1000);
    }

    getElapsedSecondsWithPenalty() {
        return this.getElapsedSeconds() + (this.hintsUsed * this.hintPenaltySeconds);
    }

    updateCounterDisplays() {
        const stats = this.getLocalStats(this.size);

        if (this.localCompletedElement) {
            this.localCompletedElement.textContent = stats.completed;
        }
        if (this.localAvgTimeElement) {
            const avgTime = stats.completed > 0 ? stats.totalTime / stats.completed : null;
            this.localAvgTimeElement.textContent = this.formatTime(avgTime);
        }
        if (this.sizeLabelElement) {
            this.sizeLabelElement.textContent = `${this.size}x${this.size}`;
        }
    }

    subscribeToGlobalStats() {
        // Unsubscribe from previous size
        if (this.currentFirebaseUnsubscribe) {
            this.currentFirebaseUnsubscribe();
            this.currentFirebaseUnsubscribe = null;
        }

        if (!firebaseInitialized || !firebaseDb) {
            return;
        }

        const statsRef = firebaseDb.ref(`stats/${this.size}`);
        const callback = (snapshot) => {
            const data = snapshot.val();
            if (this.globalAvgTimeElement && data) {
                const avgTime = data.completed > 0 ? data.totalTime / data.completed : null;
                this.globalAvgTimeElement.textContent = this.formatTime(avgTime);
            }
        };
        const errorCallback = (error) => {
            console.warn('Firebase read error (stats):', error);
        };

        statsRef.on('value', callback, errorCallback);
        this.currentFirebaseUnsubscribe = () => statsRef.off('value', callback);
    }

    async updateGlobalStats(size, solveTime) {
        // If offline or Firebase not available, queue for later
        if (!navigator.onLine || !firebaseInitialized || !firebaseDb) {
            addToOfflineQueue(size, solveTime);
            console.log('Offline - queued stats for later sync');
            return;
        }

        const statsRef = firebaseDb.ref(`stats/${size}`);
        try {
            await statsRef.transaction((current) => {
                if (current === null) {
                    return { completed: 1, totalTime: solveTime };
                }
                return {
                    completed: (current.completed || 0) + 1,
                    totalTime: (current.totalTime || 0) + solveTime
                };
            });
        } catch (error) {
            // If the transaction failed (network error), queue for later
            console.warn('Failed to update global stats, queuing for later:', error);
            addToOfflineQueue(size, solveTime);
        }
    }

    onGameStarted() {
        if (this.puzzleStartedCounted) {
            return;
        }
        this.puzzleStartedCounted = true;
        this.startTimer();
        this.updateCounterDisplays();
        this.subscribeToGlobalStats();
    }

    onGameCompleted() {
        if (this.puzzleCompleted) {
            return;
        }
        this.puzzleCompleted = true;
        this.stopTimer();

        const solveTime = this.getElapsedSecondsWithPenalty();

        // Update local stats
        const stats = this.getLocalStats(this.size);
        stats.completed++;
        stats.totalTime += solveTime;
        this.saveLocalStats(this.size, stats);
        this.updateCounterDisplays();

        // Update global stats
        this.updateGlobalStats(this.size, solveTime);
    }

    resetGameState() {
        this.puzzleStartedCounted = false;
        this.puzzleCompleted = false;
        this.hintsUsed = 0;
        this.stopTimer();
        if (this.currentTimeElement) {
            this.currentTimeElement.textContent = '0:00';
        }
    }

    // ========== CONFLICT DETECTION ==========

    findConflicts() {
        const conflicts = new Set();

        // Check rows for duplicates
        for (let row = 0; row < this.size; row++) {
            const seen = new Map(); // digit -> column
            for (let col = 0; col < this.size; col++) {
                const digit = this.grid[row][col];
                if (digit !== null) {
                    if (seen.has(digit)) {
                        conflicts.add(`${row},${col}`);
                        conflicts.add(`${row},${seen.get(digit)}`);
                    } else {
                        seen.set(digit, col);
                    }
                }
            }
        }

        // Check columns for duplicates
        for (let col = 0; col < this.size; col++) {
            const seen = new Map(); // digit -> row
            for (let row = 0; row < this.size; row++) {
                const digit = this.grid[row][col];
                if (digit !== null) {
                    if (seen.has(digit)) {
                        conflicts.add(`${row},${col}`);
                        conflicts.add(`${seen.get(digit)},${col}`);
                    } else {
                        seen.set(digit, row);
                    }
                }
            }
        }

        return conflicts;
    }

    updateConflictDisplay() {
        const conflicts = this.findConflicts();

        // Update all cells
        for (let row = 0; row < this.size; row++) {
            for (let col = 0; col < this.size; col++) {
                const input = this.gridElement.querySelector(
                    `.cell-input[data-row="${row}"][data-col="${col}"]`
                );
                if (input) {
                    if (conflicts.has(`${row},${col}`)) {
                        input.classList.add('conflict');
                    } else {
                        input.classList.remove('conflict');
                    }
                }
            }
        }
    }

    // ========== COMPLETED DIGIT DETECTION ==========

    /**
     * Check if a specific digit is complete (appears exactly N times in an NxN grid)
     * and has no conflicts. If so, flash and mark those cells.
     */
    checkCompletedDigits(digit) {
        const cellsWithDigit = [];
        const conflicts = this.findConflicts();

        // Find all cells with this digit
        for (let row = 0; row < this.size; row++) {
            for (let col = 0; col < this.size; col++) {
                if (this.grid[row][col] === digit) {
                    cellsWithDigit.push({ row, col });
                }
            }
        }

        // Check if we have exactly N instances and none are in conflict
        if (cellsWithDigit.length === this.size) {
            const hasConflict = cellsWithDigit.some(
                ({ row, col }) => conflicts.has(`${row},${col}`)
            );

            if (!hasConflict) {
                // This digit is complete! Flash and mark the cells
                this.flashCompletedDigit(cellsWithDigit);
            }
        }

        // Update all completed digit styling
        this.updateAllCompletedDigits();
    }

    /**
     * Flash animation for newly completed digit cells
     */
    flashCompletedDigit(cells) {
        for (const { row, col } of cells) {
            const input = this.gridElement.querySelector(
                `.cell-input[data-row="${row}"][data-col="${col}"]`
            );
            if (input) {
                // Remove class first to restart animation if already present
                input.classList.remove('digit-flash');
                // Trigger reflow to restart animation
                void input.offsetWidth;
                input.classList.add('digit-flash');

                // Remove flash class after animation completes
                setTimeout(() => {
                    input.classList.remove('digit-flash');
                }, 600);
            }
        }
    }

    /**
     * Update the completed styling for all digits
     */
    updateAllCompletedDigits() {
        const conflicts = this.findConflicts();
        const completedDigits = new Set();

        // Find which digits are complete (appear exactly N times with no conflicts)
        for (let digit = 1; digit <= this.size; digit++) {
            const cellsWithDigit = [];

            for (let row = 0; row < this.size; row++) {
                for (let col = 0; col < this.size; col++) {
                    if (this.grid[row][col] === digit) {
                        cellsWithDigit.push({ row, col });
                    }
                }
            }

            if (cellsWithDigit.length === this.size) {
                const hasConflict = cellsWithDigit.some(
                    ({ row, col }) => conflicts.has(`${row},${col}`)
                );
                if (!hasConflict) {
                    completedDigits.add(digit);
                }
            }
        }

        // Update all cell styling
        for (let row = 0; row < this.size; row++) {
            for (let col = 0; col < this.size; col++) {
                const input = this.gridElement.querySelector(
                    `.cell-input[data-row="${row}"][data-col="${col}"]`
                );
                if (input) {
                    const digit = this.grid[row][col];
                    if (digit !== null && completedDigits.has(digit)) {
                        input.classList.add('digit-complete');
                    } else {
                        input.classList.remove('digit-complete');
                    }
                }
            }
        }
    }

    // ========== GAME METHODS ==========

    startEntryMode() {
        this.size = parseInt(this.sizeSelect.value);
        this.initializeGrid();
        this.entryMode = true;
        this.givenCells = new Set();
        this.resetGameState();
        this.renderGrid();
        this.setupElement.classList.add('hidden');
        this.entryControlsElement.classList.remove('hidden');
        this.controlsElement.classList.add('hidden');
        this.gameContainer.classList.remove('hidden');
        this.solvabilityStatus.classList.remove('hidden');
        this.gameCounters.classList.add('hidden'); // Hide counters during entry
        this.checkSolvability();
    }

    finishEntry() {
        // Mark all currently filled cells as givens
        this.givenCells = new Set();
        for (let row = 0; row < this.size; row++) {
            for (let col = 0; col < this.size; col++) {
                if (this.grid[row][col] !== null) {
                    this.givenCells.add(`${row},${col}`);
                }
            }
        }

        // Update display to show givens
        this.syncGivenCells();

        // Switch to solving mode
        this.entryMode = false;
        this.entryControlsElement.classList.add('hidden');
        this.controlsElement.classList.remove('hidden');
        this.gameCounters.classList.remove('hidden');
        this.inputRow.classList.remove('hidden');

        // Start the timer now that solving begins
        this.onGameStarted();
    }

    syncGivenCells() {
        for (let row = 0; row < this.size; row++) {
            for (let col = 0; col < this.size; col++) {
                const input = this.gridElement.querySelector(
                    `.cell-input[data-row="${row}"][data-col="${col}"]`
                );
                if (input) {
                    if (this.givenCells.has(`${row},${col}`)) {
                        input.classList.add('given');
                    } else {
                        input.classList.remove('given');
                    }
                }
            }
        }
    }

    showSetup() {
        this.setupElement.classList.remove('hidden');
        this.controlsElement.classList.add('hidden');
        this.entryControlsElement.classList.add('hidden');
        this.gameContainer.classList.add('hidden');
        this.solvabilityStatus.classList.add('hidden');
        this.gameCounters.classList.add('hidden');
        this.inputRow.classList.add('hidden');
        this.autoDigitsEnabled = false;
        this.autoDigitsBtn.textContent = 'Auto Digits: OFF';
        this.autoDigitsBtn.classList.remove('active');
        this.candidateMode = false;
        this.candidateModeBtn.classList.remove('active');
        this.inputRow.classList.remove('candidate-mode');
        this.entryMode = false;
        this.givenCells = new Set();
    }

    // ========== PUZZLE SHARING ==========

    /**
     * Encode the current puzzle state to a compact string for URL sharing.
     * Format: size|grid|constraints
     * - grid: row-major, 0 for empty, 1-9 for digits
     * - constraints: bit-packed, 2 bits per cell (right, bottom)
     */
    encodePuzzle() {
        // Encode grid: use base36 for compactness
        let gridStr = '';
        for (let row = 0; row < this.size; row++) {
            for (let col = 0; col < this.size; col++) {
                const val = this.grid[row][col];
                gridStr += val === null ? '0' : val.toString();
            }
        }

        // Encode constraints: pack into hex
        // For each cell, we need right and bottom constraints (2 bits)
        // Pack 4 cells (8 bits) into 2 hex chars
        let constraintBits = '';
        for (let row = 0; row < this.size; row++) {
            for (let col = 0; col < this.size; col++) {
                const c = this.constraints[row][col];
                constraintBits += c.right ? '1' : '0';
                constraintBits += c.bottom ? '1' : '0';
            }
        }

        // Pad to multiple of 8 and convert to hex
        while (constraintBits.length % 8 !== 0) {
            constraintBits += '0';
        }

        let constraintHex = '';
        for (let i = 0; i < constraintBits.length; i += 8) {
            const byte = parseInt(constraintBits.substring(i, i + 8), 2);
            constraintHex += byte.toString(16).padStart(2, '0');
        }

        return `${this.size}-${gridStr}-${constraintHex}`;
    }

    /**
     * Decode a puzzle string and restore the state
     */
    decodePuzzle(encoded) {
        try {
            const parts = encoded.split('-');
            if (parts.length !== 3) return false;

            const size = parseInt(parts[0]);
            const gridStr = parts[1];
            const constraintHex = parts[2];

            if (size < 4 || size > 9) return false;
            if (gridStr.length !== size * size) return false;

            this.size = size;
            this.sizeSelect.value = size.toString();
            this.initializeGrid();

            // Decode grid
            let idx = 0;
            for (let row = 0; row < size; row++) {
                for (let col = 0; col < size; col++) {
                    const ch = gridStr[idx++];
                    if (ch === '0') {
                        this.grid[row][col] = null;
                    } else {
                        const val = parseInt(ch);
                        if (val >= 1 && val <= size) {
                            this.grid[row][col] = val;
                        }
                    }
                }
            }

            // Decode constraints
            let constraintBits = '';
            for (let i = 0; i < constraintHex.length; i += 2) {
                const byte = parseInt(constraintHex.substring(i, i + 2), 16);
                constraintBits += byte.toString(2).padStart(8, '0');
            }

            idx = 0;
            for (let row = 0; row < size; row++) {
                for (let col = 0; col < size; col++) {
                    if (idx < constraintBits.length) {
                        this.constraints[row][col].right = constraintBits[idx++] === '1';
                    }
                    if (idx < constraintBits.length) {
                        this.constraints[row][col].bottom = constraintBits[idx++] === '1';
                    }

                    // Derive left and top from neighboring cells
                    if (col > 0 && this.constraints[row][col - 1].right) {
                        // Left neighbor points right to us - that's "left cell > this cell"
                        // We don't store left/top directly, they're derived from right/bottom
                    }
                }
            }

            // Rebuild left/top constraints from right/bottom of neighbors
            for (let row = 0; row < size; row++) {
                for (let col = 0; col < size; col++) {
                    // Left constraint means "this cell > left cell"
                    // This is stored as left cell's "right" being false and we have a left marker
                    // Actually in our model, left/top are independent - let's check the original logic

                    // In the original model:
                    // constraints[row][col].right = true means "this cell > right cell"
                    // constraints[row][col].left = true means "this cell > left cell"
                    // These are independent, but for sharing we only stored right/bottom

                    // We need to check if the neighbor has the opposite constraint
                    // If right cell has constraints[row][col+1].left, that would conflict
                    // For simplicity, we don't encode left/top - they can be inferred or we encode all 4

                    // Let's re-encode with all 4 bits per cell for correctness
                }
            }

            return true;
        } catch (e) {
            console.warn('Failed to decode puzzle:', e);
            return false;
        }
    }

    /**
     * Generate shareable URL and copy to clipboard
     */
    sharePuzzle() {
        const encoded = this.encodePuzzleComplete();
        const url = `${window.location.origin}${window.location.pathname}?p=${encoded}`;

        // Copy to clipboard
        navigator.clipboard.writeText(url).then(() => {
            // Show feedback
            const originalText = this.shareBtn.textContent;
            this.shareBtn.textContent = 'Copied!';
            setTimeout(() => {
                this.shareBtn.textContent = originalText;
            }, 2000);
        }).catch(() => {
            // Fallback: show URL in prompt
            prompt('Share this URL:', url);
        });
    }

    /**
     * Encode puzzle with all 4 constraint directions per cell
     */
    encodePuzzleComplete() {
        // Encode grid
        let gridStr = '';
        for (let row = 0; row < this.size; row++) {
            for (let col = 0; col < this.size; col++) {
                const val = this.grid[row][col];
                gridStr += val === null ? '0' : val.toString();
            }
        }

        // Encode constraints: 4 bits per cell (right, bottom, left, top)
        let constraintBits = '';
        for (let row = 0; row < this.size; row++) {
            for (let col = 0; col < this.size; col++) {
                const c = this.constraints[row][col];
                constraintBits += c.right ? '1' : '0';
                constraintBits += c.bottom ? '1' : '0';
                constraintBits += c.left ? '1' : '0';
                constraintBits += c.top ? '1' : '0';
            }
        }

        // Pad to multiple of 8 and convert to hex
        while (constraintBits.length % 8 !== 0) {
            constraintBits += '0';
        }

        let constraintHex = '';
        for (let i = 0; i < constraintBits.length; i += 8) {
            const byte = parseInt(constraintBits.substring(i, i + 8), 2);
            constraintHex += byte.toString(16).padStart(2, '0');
        }

        return `${this.size}-${gridStr}-${constraintHex}`;
    }

    /**
     * Restore puzzle from URL parameter on page load
     */
    restorePuzzleFromURL() {
        const urlParams = new URLSearchParams(window.location.search);
        const puzzleParam = urlParams.get('p');

        if (!puzzleParam) return;

        try {
            const parts = puzzleParam.split('-');
            if (parts.length !== 3) return;

            const size = parseInt(parts[0]);
            const gridStr = parts[1];
            const constraintHex = parts[2];

            if (size < 4 || size > 9) return;
            if (gridStr.length !== size * size) return;

            this.size = size;
            this.sizeSelect.value = size.toString();
            this.initializeGrid();

            // Decode grid
            let idx = 0;
            for (let row = 0; row < size; row++) {
                for (let col = 0; col < size; col++) {
                    const ch = gridStr[idx++];
                    if (ch !== '0') {
                        const val = parseInt(ch);
                        if (val >= 1 && val <= size) {
                            this.grid[row][col] = val;
                        }
                    }
                }
            }

            // Decode constraints (4 bits per cell)
            let constraintBits = '';
            for (let i = 0; i < constraintHex.length; i += 2) {
                const byte = parseInt(constraintHex.substring(i, i + 2), 16);
                constraintBits += byte.toString(2).padStart(8, '0');
            }

            idx = 0;
            for (let row = 0; row < size; row++) {
                for (let col = 0; col < size; col++) {
                    if (idx + 3 < constraintBits.length) {
                        this.constraints[row][col].right = constraintBits[idx++] === '1';
                        this.constraints[row][col].bottom = constraintBits[idx++] === '1';
                        this.constraints[row][col].left = constraintBits[idx++] === '1';
                        this.constraints[row][col].top = constraintBits[idx++] === '1';
                    }
                }
            }

            // Mark all filled cells as givens
            this.givenCells = new Set();
            for (let row = 0; row < size; row++) {
                for (let col = 0; col < size; col++) {
                    if (this.grid[row][col] !== null) {
                        this.givenCells.add(`${row},${col}`);
                    }
                }
            }

            // Set up the game in entry mode so user can start solving
            this.entryMode = true;
            this.resetGameState();
            this.renderGrid();
            this.syncGridDisplay();
            this.setupElement.classList.add('hidden');
            this.entryControlsElement.classList.remove('hidden');
            this.controlsElement.classList.add('hidden');
            this.gameContainer.classList.remove('hidden');
            this.solvabilityStatus.classList.remove('hidden');
            this.gameCounters.classList.add('hidden');
            this.updateConstraintIndicators();
            this.checkSolvability();

            // Clear URL parameter to avoid re-loading on refresh
            window.history.replaceState({}, '', window.location.pathname);

        } catch (e) {
            console.warn('Failed to restore puzzle from URL:', e);
        }
    }

    initializeGrid() {
        this.grid = [];
        this.constraints = [];

        for (let row = 0; row < this.size; row++) {
            this.grid[row] = [];
            this.constraints[row] = [];
            for (let col = 0; col < this.size; col++) {
                this.grid[row][col] = null;
                this.constraints[row][col] = {
                    right: false,
                    bottom: false,
                    left: false,
                    top: false
                };
            }
        }
    }

    renderGrid() {
        this.gridElement.innerHTML = '';
        // Remove old grid-N classes and add current one for responsive scaling
        this.gridElement.className = `grid grid-${this.size}`;
        this.gridElement.style.gridTemplateColumns = `repeat(${this.size}, var(--cell-size, 50px))`;
        this.gridElement.style.gridTemplateRows = `repeat(${this.size}, var(--cell-size, 50px))`;

        for (let row = 0; row < this.size; row++) {
            for (let col = 0; col < this.size; col++) {
                const cell = this.createCell(row, col);
                this.gridElement.appendChild(cell);
            }
        }

        // Render number pad for mobile
        this.renderNumberPad();
    }

    renderNumberPad() {
        this.numberPad.innerHTML = '';

        // Create digit buttons 1 to N
        for (let d = 1; d <= this.size; d++) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'numpad-btn';
            btn.textContent = d;
            btn.addEventListener('click', () => this.onNumberPadClick(d));
            this.numberPad.appendChild(btn);
        }

        // Create erase button with eraser icon (🧽 or ⌫)
        const eraseBtn = document.createElement('button');
        eraseBtn.type = 'button';
        eraseBtn.className = 'numpad-btn erase-btn';
        eraseBtn.innerHTML = '⌫';
        eraseBtn.setAttribute('aria-label', 'Erase');
        eraseBtn.addEventListener('click', () => this.onNumberPadClick(null));
        this.numberPad.appendChild(eraseBtn);

        // Also render the input row buttons
        this.renderInputRow();
    }

    renderInputRow() {
        this.numberButtonsContainer.innerHTML = '';

        // Create digit buttons 1 to N
        for (let d = 1; d <= this.size; d++) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'input-btn number-btn';
            btn.textContent = d;
            btn.addEventListener('click', () => this.onInputRowNumberClick(d));
            this.numberButtonsContainer.appendChild(btn);
        }
    }

    toggleCandidateMode() {
        this.candidateMode = !this.candidateMode;

        if (this.candidateMode) {
            this.candidateModeBtn.classList.add('active');
            this.inputRow.classList.add('candidate-mode');
        } else {
            this.candidateModeBtn.classList.remove('active');
            this.inputRow.classList.remove('candidate-mode');
        }
    }

    onInputRowNumberClick(digit) {
        // Use selectedCell which persists even when focus moves to button
        if (!this.selectedCell) {
            // If no cell was selected, try the first empty cell
            const firstEmpty = this.gridElement.querySelector('.cell-input:not(.given)');
            if (firstEmpty) {
                firstEmpty.focus();
                this.handleInputRowDigit(firstEmpty, digit);
            }
            return;
        }

        const { row, col } = this.selectedCell;
        const input = this.gridElement.querySelector(
            `.cell-input[data-row="${row}"][data-col="${col}"]`
        );

        if (!input) return;

        // Don't allow editing given cells
        if (input.classList.contains('given')) {
            return;
        }

        this.handleInputRowDigit(input, digit);
    }

    handleInputRowDigit(input, digit) {
        const row = parseInt(input.dataset.row);
        const col = parseInt(input.dataset.col);

        if (this.candidateMode && !this.entryMode) {
            // In candidate mode, toggle the candidate for this digit
            this.toggleCandidate(row, col, digit);
        } else {
            // Normal mode - set the digit (same flow as keyboard input)
            this.grid[row][col] = digit;
            input.value = digit;
            input.classList.add('has-value');
            // Clear any candidate eliminations when placing a value
            this.clearCandidateEliminations(row, col);
            this.updateAutoDigits();
            this.updateConflictDisplay();
            this.checkCompletedDigits(digit);
            this.checkSolvability();
        }
    }

    toggleCandidate(row, col, digit) {
        // Only allow candidate toggling on empty cells
        if (this.grid[row][col] !== null) {
            return;
        }

        const cell = this.gridElement.querySelector(`.grid-cell[data-row="${row}"][data-col="${col}"]`);
        if (!cell) return;

        const autoDigitsContainer = cell.querySelector('.auto-digits');
        if (!autoDigitsContainer) return;

        const digitSpan = autoDigitsContainer.querySelector(`.auto-digit[data-digit="${digit}"]`);
        if (!digitSpan) return;

        // Toggle the eliminated state
        if (digitSpan.classList.contains('eliminated')) {
            digitSpan.classList.remove('eliminated');
        } else {
            digitSpan.classList.add('eliminated');
        }

        // Make sure auto-digits are visible when in candidate mode
        if (!this.autoDigitsEnabled) {
            this.toggleAutoDigits();
        }
    }

    onEraserClick() {
        // Use selectedCell which persists even when focus moves to button
        if (!this.selectedCell) {
            return;
        }

        const { row, col } = this.selectedCell;
        const input = this.gridElement.querySelector(
            `.cell-input[data-row="${row}"][data-col="${col}"]`
        );

        if (!input) return;

        // Don't allow erasing given cells
        if (input.classList.contains('given')) {
            return;
        }

        if (this.candidateMode) {
            // In candidate mode, clear all eliminations for this cell
            this.clearCandidateEliminations(row, col);
        } else {
            // Normal mode - clear the cell
            input.value = '';
            this.grid[row][col] = null;
            input.classList.remove('has-value', 'conflict');
            this.checkConflicts();
            this.updateAutoDigits();
            this.updateAllCompletedDigits();

            if (!this.entryMode) {
                this.checkSolvability();
            }
        }
    }

    clearCandidateEliminations(row, col) {
        const cell = this.gridElement.querySelector(`.grid-cell[data-row="${row}"][data-col="${col}"]`);
        if (!cell) return;

        const autoDigitsContainer = cell.querySelector('.auto-digits');
        if (!autoDigitsContainer) return;

        const digitSpans = autoDigitsContainer.querySelectorAll('.auto-digit');
        digitSpans.forEach(span => span.classList.remove('eliminated'));
    }

    onNumberPadClick(digit) {
        // Find the currently focused cell
        const focused = this.gridElement.querySelector('.cell-input:focus');
        if (!focused) {
            // If no cell is focused, focus the first empty cell
            const firstEmpty = this.gridElement.querySelector('.cell-input:not(.given)');
            if (firstEmpty) {
                firstEmpty.focus();
                this.handleNumberPadInput(firstEmpty, digit);
            }
            return;
        }

        // Don't allow editing given cells
        if (focused.classList.contains('given')) {
            return;
        }

        this.handleNumberPadInput(focused, digit);
    }

    handleNumberPadInput(input, digit) {
        const row = parseInt(input.dataset.row);
        const col = parseInt(input.dataset.col);

        if (digit === null) {
            // Erase
            input.value = '';
            this.grid[row][col] = null;
            input.classList.remove('has-value', 'conflict');
        } else {
            // Set digit
            input.value = digit;
            this.grid[row][col] = digit;
            input.classList.add('has-value');
            // Clear any candidate eliminations when placing a value
            this.clearCandidateEliminations(row, col);
        }

        this.checkConflicts();
        this.updateAutoDigits();
        this.updateDigitCompletionHighlighting(digit);

        if (!this.entryMode) {
            this.checkSolvability();
        }
    }

    createCell(row, col) {
        const cell = document.createElement('div');
        cell.className = 'grid-cell';
        cell.dataset.row = row;
        cell.dataset.col = col;

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'cell-input';
        input.maxLength = 1;
        input.inputMode = 'none'; // Prevent software keyboard on touch devices
        input.dataset.row = row;
        input.dataset.col = col;

        input.addEventListener('focus', () => this.onCellFocus(row, col));
        input.addEventListener('keydown', (e) => this.onKeyDown(e, row, col));
        input.addEventListener('input', (e) => this.onInput(e, row, col));

        cell.appendChild(input);

        // Add constraint indicators
        this.addConstraintIndicators(cell, row, col);

        // Add auto-digits container
        const autoDigitsContainer = document.createElement('div');
        autoDigitsContainer.className = 'auto-digits';
        autoDigitsContainer.style.display = 'none';

        for (let d = 1; d <= 9; d++) {
            const digitSpan = document.createElement('span');
            digitSpan.className = 'auto-digit';
            digitSpan.dataset.digit = d;
            digitSpan.textContent = d;
            autoDigitsContainer.appendChild(digitSpan);
        }

        cell.appendChild(autoDigitsContainer);

        return cell;
    }

    addConstraintIndicators(cell, row, col) {
        const directions = ['right', 'left', 'top', 'bottom'];
        directions.forEach(dir => {
            const indicator = document.createElement('div');
            indicator.className = `constraint constraint-${dir}`;
            indicator.style.display = 'none';
            indicator.dataset.direction = dir;
            cell.appendChild(indicator);
        });
    }

    onCellFocus(row, col) {
        this.selectedCell = { row, col };
        this.clearHintHighlight();
    }

    onKeyDown(e, row, col) {
        const key = e.key.toUpperCase();
        const isGiven = this.givenCells.has(`${row},${col}`);

        // Handle constraint keys (only in entry mode)
        if (['L', 'R', 'T', 'B'].includes(key)) {
            e.preventDefault();
            if (this.entryMode) {
                this.toggleConstraint(row, col, key);
            }
            return;
        }

        // Handle delete/backspace (not for given cells in solve mode)
        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (!this.entryMode && isGiven) {
                e.preventDefault();
                return;
            }

            // In candidate mode, clear all candidate eliminations for this cell
            if (this.candidateMode && !this.entryMode) {
                e.preventDefault();
                this.clearCandidateEliminations(row, col);
                return;
            }

            this.grid[row][col] = null;
            e.target.value = '';
            e.target.classList.remove('has-value');
            this.updateAutoDigits();
            this.updateConflictDisplay();
            this.updateAllCompletedDigits();
            this.checkSolvability();
            return;
        }

        // Handle arrow keys for navigation
        if (e.key.startsWith('Arrow')) {
            e.preventDefault();
            this.navigateGrid(row, col, e.key);
            return;
        }

        // Handle digit keys - allow direct overwrite (not for given cells in solve mode)
        const num = parseInt(e.key);
        if (num >= 1 && num <= this.size) {
            e.preventDefault();
            if (!this.entryMode && isGiven) {
                return;
            }

            // In candidate mode, toggle the candidate instead of setting the value
            if (this.candidateMode && !this.entryMode) {
                this.toggleCandidate(row, col, num);
                return;
            }

            this.grid[row][col] = num;
            e.target.value = num;
            e.target.classList.add('has-value');
            // Clear any candidate eliminations when placing a value
            this.clearCandidateEliminations(row, col);
            this.updateAutoDigits();
            this.updateConflictDisplay();
            this.checkCompletedDigits(num);
            this.checkSolvability();
            return;
        }

        // Block other character input
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
        }
    }

    onInput(e, row, col) {
        // Prevent editing given cells in solve mode
        const isGiven = this.givenCells.has(`${row},${col}`);
        if (!this.entryMode && isGiven) {
            // Restore the original value
            e.target.value = this.grid[row][col];
            return;
        }

        // Handle paste or other input methods
        const value = e.target.value;
        const num = parseInt(value.slice(-1)); // Get last character for paste handling

        if (num >= 1 && num <= this.size) {
            this.grid[row][col] = num;
            e.target.value = num;
            e.target.classList.add('has-value');
            this.checkCompletedDigits(num);
        } else {
            this.grid[row][col] = null;
            e.target.value = '';
            e.target.classList.remove('has-value');
            this.updateAllCompletedDigits();
        }

        this.updateAutoDigits();
        this.updateConflictDisplay();
        this.checkSolvability();
    }

    toggleConstraint(row, col, direction) {
        const dirMap = {
            'L': { prop: 'left', dRow: 0, dCol: -1, opposite: 'right' },
            'R': { prop: 'right', dRow: 0, dCol: 1, opposite: 'left' },
            'T': { prop: 'top', dRow: -1, dCol: 0, opposite: 'bottom' },
            'B': { prop: 'bottom', dRow: 1, dCol: 0, opposite: 'top' }
        };

        const { prop, dRow, dCol, opposite } = dirMap[direction];
        const newRow = row + dRow;
        const newCol = col + dCol;

        // Check bounds
        if (newRow < 0 || newRow >= this.size || newCol < 0 || newCol >= this.size) {
            return;
        }

        // Toggle this constraint
        const currentValue = this.constraints[row][col][prop];

        // If turning on, make sure the opposite direction on the other cell is off
        if (!currentValue) {
            this.constraints[newRow][newCol][opposite] = false;
        }

        this.constraints[row][col][prop] = !currentValue;

        // Update visual indicators
        this.updateConstraintIndicators();
        this.updateAutoDigits();
        this.checkSolvability();
    }

    updateConstraintIndicators() {
        const cells = this.gridElement.querySelectorAll('.grid-cell');

        cells.forEach(cell => {
            const row = parseInt(cell.dataset.row);
            const col = parseInt(cell.dataset.col);
            const cellConstraints = this.constraints[row][col];

            ['right', 'left', 'top', 'bottom'].forEach(dir => {
                const indicator = cell.querySelector(`.constraint-${dir}`);
                indicator.style.display = cellConstraints[dir] ? 'block' : 'none';
            });
        });
    }

    navigateGrid(row, col, arrowKey) {
        let newRow = row;
        let newCol = col;

        switch (arrowKey) {
            case 'ArrowUp': newRow = Math.max(0, row - 1); break;
            case 'ArrowDown': newRow = Math.min(this.size - 1, row + 1); break;
            case 'ArrowLeft': newCol = Math.max(0, col - 1); break;
            case 'ArrowRight': newCol = Math.min(this.size - 1, col + 1); break;
        }

        const input = this.gridElement.querySelector(
            `.cell-input[data-row="${newRow}"][data-col="${newCol}"]`
        );
        if (input) {
            input.focus();
        }
    }

    toggleAutoDigits() {
        this.autoDigitsEnabled = !this.autoDigitsEnabled;
        this.autoDigitsBtn.textContent = `Auto Digits: ${this.autoDigitsEnabled ? 'ON' : 'OFF'}`;
        this.autoDigitsBtn.classList.toggle('active', this.autoDigitsEnabled);
        this.updateAutoDigits();
    }

    updateAutoDigits() {
        const cells = this.gridElement.querySelectorAll('.grid-cell');

        cells.forEach(cell => {
            const row = parseInt(cell.dataset.row);
            const col = parseInt(cell.dataset.col);
            const autoDigitsContainer = cell.querySelector('.auto-digits');
            const input = cell.querySelector('.cell-input');

            if (!this.autoDigitsEnabled || this.grid[row][col] !== null) {
                autoDigitsContainer.style.display = 'none';
                cell.classList.remove('has-auto-digits');
                input.style.background = this.grid[row][col] !== null ? '#ebf8ff' : 'white';
                return;
            }

            const possibleDigits = this.getPossibleDigits(row, col);
            autoDigitsContainer.style.display = 'grid';
            cell.classList.add('has-auto-digits');
            input.style.background = 'transparent';

            const digitSpans = autoDigitsContainer.querySelectorAll('.auto-digit');
            digitSpans.forEach(span => {
                const digit = parseInt(span.dataset.digit);
                if (digit > this.size) {
                    span.style.display = 'none';
                } else {
                    span.style.display = 'flex';
                    span.style.visibility = possibleDigits.has(digit) ? 'visible' : 'hidden';
                }
            });
        });
    }

    getPossibleDigits(row, col) {
        // Build possible values for ALL cells, then iteratively apply constraints
        const allPossible = this.computeAllPossibleDigits();
        return allPossible[row][col];
    }

    computeAllPossibleDigits() {
        // Initialize: for each cell, start with all digits not already in row/column
        const possible = [];
        for (let row = 0; row < this.size; row++) {
            possible[row] = [];
            for (let col = 0; col < this.size; col++) {
                if (this.grid[row][col] !== null) {
                    // Cell has a value - only that value is possible
                    possible[row][col] = new Set([this.grid[row][col]]);
                } else {
                    // Start with all digits
                    possible[row][col] = new Set();
                    for (let d = 1; d <= this.size; d++) {
                        possible[row][col].add(d);
                    }
                    // Remove digits already in same row
                    for (let c = 0; c < this.size; c++) {
                        if (this.grid[row][c] !== null) {
                            possible[row][col].delete(this.grid[row][c]);
                        }
                    }
                    // Remove digits already in same column
                    for (let r = 0; r < this.size; r++) {
                        if (this.grid[r][col] !== null) {
                            possible[row][col].delete(this.grid[r][col]);
                        }
                    }
                }
            }
        }

        // Iteratively apply constraints until no changes
        let changed = true;
        while (changed) {
            changed = false;
            for (let row = 0; row < this.size; row++) {
                for (let col = 0; col < this.size; col++) {
                    if (this.applyConstraintsPropagation(row, col, possible)) {
                        changed = true;
                    }
                }
            }
        }

        return possible;
    }

    applyConstraintsPropagation(row, col, allPossible) {
        const myPossible = allPossible[row][col];
        if (myPossible.size === 0) return false;

        const sizeBefore = myPossible.size;
        const constraints = this.constraints[row][col];

        // For each direction where this cell > neighbor
        const greaterThan = [
            { hasConstraint: constraints.right, nRow: row, nCol: col + 1 },
            { hasConstraint: constraints.left, nRow: row, nCol: col - 1 },
            { hasConstraint: constraints.top, nRow: row - 1, nCol: col },
            { hasConstraint: constraints.bottom, nRow: row + 1, nCol: col }
        ];

        for (const { hasConstraint, nRow, nCol } of greaterThan) {
            if (hasConstraint && nRow >= 0 && nRow < this.size && nCol >= 0 && nCol < this.size) {
                const neighborPossible = allPossible[nRow][nCol];
                if (neighborPossible.size === 0 || myPossible.size === 0) continue;

                const neighborMin = Math.min(...neighborPossible);
                const myMax = Math.max(...myPossible);

                // Remove values from this cell that are <= neighbor's min
                for (let d = 1; d <= neighborMin; d++) {
                    myPossible.delete(d);
                }

                // Remove values from neighbor that are >= this cell's max
                for (let d = myMax; d <= this.size; d++) {
                    neighborPossible.delete(d);
                }
            }
        }

        // For each direction where neighbor > this cell
        const lessThan = [
            { nRow: row, nCol: col + 1, prop: 'left' },   // right neighbor has left constraint
            { nRow: row, nCol: col - 1, prop: 'right' },  // left neighbor has right constraint
            { nRow: row - 1, nCol: col, prop: 'bottom' }, // top neighbor has bottom constraint
            { nRow: row + 1, nCol: col, prop: 'top' }     // bottom neighbor has top constraint
        ];

        for (const { nRow, nCol, prop } of lessThan) {
            if (nRow >= 0 && nRow < this.size && nCol >= 0 && nCol < this.size) {
                if (this.constraints[nRow][nCol][prop]) {
                    const neighborPossible = allPossible[nRow][nCol];
                    if (neighborPossible.size === 0 || myPossible.size === 0) continue;

                    const neighborMax = Math.max(...neighborPossible);

                    // Remove values from this cell that are >= neighbor's max
                    for (let d = neighborMax; d <= this.size; d++) {
                        myPossible.delete(d);
                    }
                }
            }
        }

        // Multi-constraint propagation: when multiple neighbors on the same row or column
        // have constraints pointing to/from this cell, they must have distinct values
        this.applyMultiConstraintPropagation(row, col, allPossible);

        return myPossible.size !== sizeBefore;
    }

    /**
     * Handle constraints where multiple neighbors on the same row/column point to or from this cell.
     * If this cell must be smaller than N neighbors on the same row/column with max value M,
     * this cell's max is M - N (since neighbors must be distinct and all > this cell).
     * Similarly for minimum values.
     */
    applyMultiConstraintPropagation(row, col, allPossible) {
        const myPossible = allPossible[row][col];
        if (myPossible.size === 0) return;

        const constraints = this.constraints[row][col];

        // Collect neighbors that are greater than this cell, grouped by row/column
        // Row neighbors (left and right) where neighbor > this cell
        const rowNeighborsGreater = [];
        // Check if left neighbor > this cell
        if (col > 0 && this.constraints[row][col - 1].right) {
            rowNeighborsGreater.push({ nRow: row, nCol: col - 1 });
        }
        // Check if right neighbor > this cell
        if (col < this.size - 1 && this.constraints[row][col + 1].left) {
            rowNeighborsGreater.push({ nRow: row, nCol: col + 1 });
        }

        // Column neighbors (top and bottom) where neighbor > this cell
        const colNeighborsGreater = [];
        // Check if top neighbor > this cell
        if (row > 0 && this.constraints[row - 1][col].bottom) {
            colNeighborsGreater.push({ nRow: row - 1, nCol: col });
        }
        // Check if bottom neighbor > this cell
        if (row < this.size - 1 && this.constraints[row + 1][col].top) {
            colNeighborsGreater.push({ nRow: row + 1, nCol: col });
        }

        // Row neighbors where this cell > neighbor
        const rowNeighborsSmaller = [];
        if (constraints.left && col > 0) {
            rowNeighborsSmaller.push({ nRow: row, nCol: col - 1 });
        }
        if (constraints.right && col < this.size - 1) {
            rowNeighborsSmaller.push({ nRow: row, nCol: col + 1 });
        }

        // Column neighbors where this cell > neighbor
        const colNeighborsSmaller = [];
        if (constraints.top && row > 0) {
            colNeighborsSmaller.push({ nRow: row - 1, nCol: col });
        }
        if (constraints.bottom && row < this.size - 1) {
            colNeighborsSmaller.push({ nRow: row + 1, nCol: col });
        }

        // If multiple row neighbors are greater than this cell, apply stricter max
        if (rowNeighborsGreater.length >= 2) {
            const maxValues = rowNeighborsGreater.map(n => {
                const np = allPossible[n.nRow][n.nCol];
                return np.size > 0 ? Math.max(...np) : this.size;
            });
            // Sort ascending to find the N-th smallest max
            maxValues.sort((a, b) => a - b);
            // This cell must be less than all of them, and they must be distinct
            // So this cell's max is at most (N-th smallest max) - N
            const strictMax = maxValues[rowNeighborsGreater.length - 1] - rowNeighborsGreater.length;
            for (let d = strictMax + 1; d <= this.size; d++) {
                myPossible.delete(d);
            }
        }

        // If multiple column neighbors are greater than this cell
        if (colNeighborsGreater.length >= 2) {
            const maxValues = colNeighborsGreater.map(n => {
                const np = allPossible[n.nRow][n.nCol];
                return np.size > 0 ? Math.max(...np) : this.size;
            });
            maxValues.sort((a, b) => a - b);
            const strictMax = maxValues[colNeighborsGreater.length - 1] - colNeighborsGreater.length;
            for (let d = strictMax + 1; d <= this.size; d++) {
                myPossible.delete(d);
            }
        }

        // If multiple row neighbors are smaller than this cell, apply stricter min
        if (rowNeighborsSmaller.length >= 2) {
            const minValues = rowNeighborsSmaller.map(n => {
                const np = allPossible[n.nRow][n.nCol];
                return np.size > 0 ? Math.min(...np) : 1;
            });
            // Sort descending to find the N-th largest min
            minValues.sort((a, b) => b - a);
            // This cell must be greater than all of them, and they must be distinct
            // So this cell's min is at least (N-th largest min) + N
            const strictMin = minValues[rowNeighborsSmaller.length - 1] + rowNeighborsSmaller.length;
            for (let d = 1; d < strictMin; d++) {
                myPossible.delete(d);
            }
        }

        // If multiple column neighbors are smaller than this cell
        if (colNeighborsSmaller.length >= 2) {
            const minValues = colNeighborsSmaller.map(n => {
                const np = allPossible[n.nRow][n.nCol];
                return np.size > 0 ? Math.min(...np) : 1;
            });
            minValues.sort((a, b) => b - a);
            const strictMin = minValues[colNeighborsSmaller.length - 1] + colNeighborsSmaller.length;
            for (let d = 1; d < strictMin; d++) {
                myPossible.delete(d);
            }
        }
    }

    findHiddenSingle() {
        // Find a cell where a digit can only go in one position in a row or column
        // Returns { row, col, digit } or null if none found

        // Check each row for hidden singles
        for (let row = 0; row < this.size; row++) {
            // For each digit, find which empty cells in this row can hold it
            for (let digit = 1; digit <= this.size; digit++) {
                // Skip if digit already placed in this row
                let alreadyPlaced = false;
                for (let col = 0; col < this.size; col++) {
                    if (this.grid[row][col] === digit) {
                        alreadyPlaced = true;
                        break;
                    }
                }
                if (alreadyPlaced) continue;

                // Find all cells in this row where this digit can go
                const possibleCols = [];
                for (let col = 0; col < this.size; col++) {
                    if (this.grid[row][col] === null) {
                        const possible = this.getPossibleDigits(row, col);
                        if (possible.has(digit)) {
                            possibleCols.push(col);
                        }
                    }
                }

                // If exactly one cell can hold this digit, it's a hidden single
                if (possibleCols.length === 1) {
                    return { row, col: possibleCols[0], digit };
                }
            }
        }

        // Check each column for hidden singles
        for (let col = 0; col < this.size; col++) {
            for (let digit = 1; digit <= this.size; digit++) {
                // Skip if digit already placed in this column
                let alreadyPlaced = false;
                for (let row = 0; row < this.size; row++) {
                    if (this.grid[row][col] === digit) {
                        alreadyPlaced = true;
                        break;
                    }
                }
                if (alreadyPlaced) continue;

                // Find all cells in this column where this digit can go
                const possibleRows = [];
                for (let row = 0; row < this.size; row++) {
                    if (this.grid[row][col] === null) {
                        const possible = this.getPossibleDigits(row, col);
                        if (possible.has(digit)) {
                            possibleRows.push(row);
                        }
                    }
                }

                // If exactly one cell can hold this digit, it's a hidden single
                if (possibleRows.length === 1) {
                    return { row: possibleRows[0], col, digit };
                }
            }
        }

        return null;
    }

    showHint() {
        // If we have a pending hint from stage 1, show the cell (stage 2)
        if (this.pendingHint) {
            const hint = this.pendingHint;  // Save hint BEFORE clearing
            this.clearHintHighlight();      // This sets pendingHint to null

            // Apply hint penalty when revealing the cell
            this.hintsUsed++;
            this.updateTimerDisplay();

            this.highlightHintCell(hint.row, hint.col, hint.detailMessage);
            return;
        }

        // Clear any existing hint highlight
        this.clearHintHighlight();

        // First, find a cell that has exactly one possible digit (naked single)
        for (let row = 0; row < this.size; row++) {
            for (let col = 0; col < this.size; col++) {
                if (this.grid[row][col] === null) {
                    const possibleDigits = this.getPossibleDigits(row, col);
                    if (possibleDigits.size === 1) {
                        const digit = [...possibleDigits][0];
                        this.showStrategyHint({
                            strategy: 'Naked Single',
                            message: 'Look for a cell with only one possible digit',
                            row,
                            col,
                            detailMessage: `Cell can only be ${digit}`
                        });
                        return;
                    }
                }
            }
        }

        // Next, check for hidden singles (digit can only go in one cell in row/column)
        const hiddenSingle = this.findHiddenSingle();
        if (hiddenSingle) {
            this.showStrategyHint({
                strategy: 'Hidden Single',
                message: `Look for where ${hiddenSingle.digit} can go in a row or column`,
                row: hiddenSingle.row,
                col: hiddenSingle.col,
                detailMessage: `${hiddenSingle.digit} can only go in this cell`
            });
            return;
        }

        // Try advanced strategies to find eliminations that might reveal singles
        const advancedResult = this.applyAdvancedStrategies();
        if (advancedResult) {
            const { affectedCell, type, eliminated, pairDigits, digit } = advancedResult;
            let strategy = '';
            let message = '';
            let detailMessage = '';

            switch (type) {
                case 'nakedPair':
                    strategy = 'Naked Pair';
                    message = 'Look for two cells with the same two candidates';
                    detailMessage = `Eliminate ${[...eliminated].join(', ')} from this cell (naked pair: ${pairDigits.join(', ')})`;
                    break;
                case 'nakedTriplet':
                    strategy = 'Naked Triplet';
                    message = 'Look for three cells whose candidates are limited to three digits';
                    detailMessage = `Eliminate ${[...eliminated].join(', ')} from this cell (naked triplet: ${advancedResult.tripletDigits.join(', ')})`;
                    break;
                case 'nakedQuadruplet':
                    strategy = 'Naked Quadruplet';
                    message = 'Look for four cells whose candidates are limited to four digits';
                    detailMessage = `Eliminate ${[...eliminated].join(', ')} from this cell (naked quadruplet: ${advancedResult.quadDigits.join(', ')})`;
                    break;
                case 'hiddenPair':
                    strategy = 'Hidden Pair';
                    message = 'Look for two digits that only appear in two cells';
                    detailMessage = `Keep only ${advancedResult.pairDigits.join(', ')} in this cell`;
                    break;
                case 'xWing':
                    strategy = 'X-Wing';
                    message = `Look for ${digit} forming a rectangle pattern in rows/columns`;
                    detailMessage = `Eliminate ${digit} from this cell (X-Wing pattern)`;
                    break;
                case 'hiddenTriplet':
                    strategy = 'Hidden Triplet';
                    message = 'Look for three digits that only appear in three cells';
                    detailMessage = `Keep only ${advancedResult.tripletDigits.join(', ')} in this cell`;
                    break;
                case 'hiddenQuadruplet':
                    strategy = 'Hidden Quadruplet';
                    message = 'Look for four digits that only appear in four cells';
                    detailMessage = `Keep only ${advancedResult.quadDigits.join(', ')} in this cell`;
                    break;
            }

            this.showStrategyHint({
                strategy,
                message,
                row: affectedCell.row,
                col: affectedCell.col,
                detailMessage
            });
            return;
        }

        // No solvable cell found - briefly flash the hint button to indicate this
        this.hintBtn.classList.add('no-hint');
        setTimeout(() => {
            this.hintBtn.classList.remove('no-hint');
        }, 500);
    }

    showStrategyHint(hintInfo) {
        // Stage 1: Show just the strategy name and general hint
        this.pendingHint = hintInfo;

        // Apply 30s penalty for showing hint
        this.hintsUsed++;
        this.updateTimerDisplay();

        if (this.solvabilityStatus) {
            this.solvabilityStatus.textContent = `${hintInfo.strategy}: ${hintInfo.message}`;
            this.solvabilityStatus.className = 'solvability-status hint-message';
        }

        // Update button text to indicate second click will show cell
        this.hintBtn.textContent = 'Show Cell';
        this.hintBtn.classList.add('hint-pending');
    }

    highlightHintCell(row, col, message = '') {
        const input = this.gridElement.querySelector(
            `.cell-input[data-row="${row}"][data-col="${col}"]`
        );
        if (input) {
            input.classList.add('hint-highlight');
            input.focus();

            // Show hint message if provided
            if (message && this.solvabilityStatus) {
                this.solvabilityStatus.textContent = message;
                this.solvabilityStatus.className = 'solvability-status hint-message';
            }
        }
    }

    clearHintHighlight() {
        const highlighted = this.gridElement.querySelectorAll('.hint-highlight');
        highlighted.forEach(el => el.classList.remove('hint-highlight'));

        // Reset pending hint and button state
        this.pendingHint = null;
        this.hintBtn.textContent = 'Hint';
        this.hintBtn.classList.remove('hint-pending');
    }

    checkSolvability() {
        // Check if puzzle is complete first (fast check)
        const isComplete = this.grid.every(row => row.every(cell => cell !== null));

        if (isComplete) {
            // Verify it's valid (no conflicts)
            const conflicts = this.findConflicts();
            const isSolvable = conflicts.size === 0;
            this.updateSolvabilityDisplay(isSolvable, isComplete && isSolvable, { steps: 0, timeMs: 0 });
            return;
        }

        // Cancel any ongoing solve
        if (this.solveAbortController) {
            this.solveAbortController.abort();
        }
        this.solveAbortController = { aborted: false, abort() { this.aborted = true; } };

        // Reset gave up flag
        this.solveGaveUp = false;

        // Show solving progress
        this.solvabilityStatus.textContent = 'Solving...';
        this.solvabilityStatus.className = 'solvability-status solving';

        // Use async check to avoid blocking the UI/timer
        this.checkSolvabilityAsync();
    }

    async checkSolvabilityAsync() {
        const gridCopy = this.grid.map(row => [...row]);
        const abortController = this.solveAbortController;
        this.solveSteps = 0;
        this.solveStartTime = performance.now();

        const result = await this.solveIterative(gridCopy, abortController);

        // Only update display if this solve wasn't aborted
        if (!abortController.aborted) {
            const solveTime = performance.now() - this.solveStartTime;
            this.updateSolvabilityDisplay(result, false, {
                steps: this.solveSteps,
                timeMs: solveTime
            });
        }
    }

    async solveIterative(grid, abortController) {
        // Optimized solver with MRV heuristic and incremental constraint propagation
        const maxSteps = 1000000;
        const yieldInterval = 5000; // Yield less frequently
        const progressInterval = 20000;

        // Compute initial possible digits with full propagation
        let possible = this.computeAllPossibleDigitsForGrid(grid);

        // Check for immediate contradiction
        for (let r = 0; r < this.size; r++) {
            for (let c = 0; c < this.size; c++) {
                if (grid[r][c] === null && possible[r][c].size === 0) {
                    return false;
                }
            }
        }

        // Stack holds: { row, col, digit, savedPossible }
        const stack = [];

        while (this.solveSteps < maxSteps) {
            if (abortController.aborted) return false;

            this.solveSteps++;

            if (this.solveSteps % yieldInterval === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }

            if (this.solveSteps % progressInterval === 0) {
                const elapsed = ((performance.now() - this.solveStartTime) / 1000).toFixed(1);
                this.solvabilityStatus.textContent = `Solving... (${this.solveSteps} steps, ${elapsed}s)`;
            }

            // Find empty cell with MRV (minimum remaining values)
            let bestCell = null;
            let bestCount = this.size + 1;
            for (let r = 0; r < this.size; r++) {
                for (let c = 0; c < this.size; c++) {
                    if (grid[r][c] === null) {
                        const count = possible[r][c].size;
                        if (count === 0) {
                            // Dead end - backtrack
                            bestCell = null;
                            bestCount = 0;
                            break;
                        }
                        if (count < bestCount) {
                            bestCount = count;
                            bestCell = { row: r, col: c };
                            if (count === 1) break; // Can't do better
                        }
                    }
                }
                if (bestCount === 0 || bestCount === 1) break;
            }

            if (bestCell === null) {
                if (bestCount === 0) {
                    // Contradiction - backtrack
                    if (stack.length === 0) return false;
                    const prev = stack.pop();
                    grid[prev.row][prev.col] = null;
                    possible = prev.savedPossible;
                    continue;
                }
                // All cells filled - solved!
                return true;
            }

            const { row, col } = bestCell;
            const digits = [...possible[row][col]];

            if (digits.length === 0) {
                // Backtrack
                if (stack.length === 0) return false;
                const prev = stack.pop();
                grid[prev.row][prev.col] = null;
                possible = prev.savedPossible;
                continue;
            }

            // Try first digit, save state for backtracking
            const digit = digits[0];
            const savedPossible = possible.map(row => row.map(set => new Set(set)));

            // Remove other digits from this cell's possibilities for future backtracks
            savedPossible[row][col] = new Set(digits.slice(1));

            stack.push({ row, col, digit, savedPossible });

            // Place digit and propagate constraints
            grid[row][col] = digit;
            possible[row][col] = new Set([digit]);

            // Propagate: remove digit from same row/column
            let contradiction = false;
            for (let c = 0; c < this.size && !contradiction; c++) {
                if (c !== col && grid[row][c] === null) {
                    possible[row][c].delete(digit);
                    if (possible[row][c].size === 0) contradiction = true;
                }
            }
            for (let r = 0; r < this.size && !contradiction; r++) {
                if (r !== row && grid[r][col] === null) {
                    possible[r][col].delete(digit);
                    if (possible[r][col].size === 0) contradiction = true;
                }
            }

            // Apply constraint propagation for affected cells
            if (!contradiction) {
                contradiction = !this.propagateConstraintsForGrid(grid, possible);
            }

            if (contradiction) {
                // Backtrack immediately
                grid[row][col] = null;
                const prev = stack.pop();
                possible = prev.savedPossible;
            }
        }

        this.solveGaveUp = true;
        return false;
    }

    propagateConstraintsForGrid(grid, possible) {
        // Apply constraint propagation until stable
        let changed = true;
        let iterations = 0;
        const maxIterations = this.size * this.size * 2;

        while (changed && iterations < maxIterations) {
            changed = false;
            iterations++;

            for (let row = 0; row < this.size; row++) {
                for (let col = 0; col < this.size; col++) {
                    if (grid[row][col] !== null) continue;

                    const before = possible[row][col].size;
                    if (before === 0) return false;

                    // Apply inequality constraints
                    const constraints = this.constraints[row][col];

                    // This cell > neighbor: remove values <= min(neighbor)
                    const greaterDirs = [
                        { has: constraints.right, nr: row, nc: col + 1 },
                        { has: constraints.left, nr: row, nc: col - 1 },
                        { has: constraints.bottom, nr: row + 1, nc: col },
                        { has: constraints.top, nr: row - 1, nc: col }
                    ];

                    for (const { has, nr, nc } of greaterDirs) {
                        if (has && nr >= 0 && nr < this.size && nc >= 0 && nc < this.size) {
                            const neighborMin = Math.min(...possible[nr][nc]);
                            for (const d of [...possible[row][col]]) {
                                if (d <= neighborMin) possible[row][col].delete(d);
                            }
                        }
                    }

                    // This cell < neighbor: remove values >= max(neighbor)
                    const lessDirs = [
                        { nr: row, nc: col + 1 },
                        { nr: row, nc: col - 1 },
                        { nr: row + 1, nc: col },
                        { nr: row - 1, nc: col }
                    ];

                    for (const { nr, nc } of lessDirs) {
                        if (nr >= 0 && nr < this.size && nc >= 0 && nc < this.size) {
                            const neighborConstraints = this.constraints[nr][nc];
                            const isLessThan =
                                (nc === col + 1 && neighborConstraints.left) ||
                                (nc === col - 1 && neighborConstraints.right) ||
                                (nr === row + 1 && neighborConstraints.top) ||
                                (nr === row - 1 && neighborConstraints.bottom);

                            if (isLessThan) {
                                const neighborMax = Math.max(...possible[nr][nc]);
                                for (const d of [...possible[row][col]]) {
                                    if (d >= neighborMax) possible[row][col].delete(d);
                                }
                            }
                        }
                    }

                    if (possible[row][col].size === 0) return false;
                    if (possible[row][col].size !== before) changed = true;

                    // Naked singles: if only one cell in row/col can have a digit, assign it
                    if (possible[row][col].size === 1) {
                        const digit = [...possible[row][col]][0];
                        for (let c = 0; c < this.size; c++) {
                            if (c !== col && grid[row][c] === null) {
                                if (possible[row][c].delete(digit)) changed = true;
                                if (possible[row][c].size === 0) return false;
                            }
                        }
                        for (let r = 0; r < this.size; r++) {
                            if (r !== row && grid[r][col] === null) {
                                if (possible[r][col].delete(digit)) changed = true;
                                if (possible[r][col].size === 0) return false;
                            }
                        }
                    }
                }
            }
        }
        return true;
    }

    // Keep the recursive solve for internal use (e.g., puzzle generation)
    solve(grid) {
        // Limit iterations to prevent hanging
        this.solveSteps = (this.solveSteps || 0) + 1;
        if (this.solveSteps > 50000) {
            this.solveGaveUp = true;
            return false;
        }

        // Find the next empty cell
        let emptyCell = null;
        for (let row = 0; row < this.size; row++) {
            for (let col = 0; col < this.size; col++) {
                if (grid[row][col] === null) {
                    emptyCell = { row, col };
                    break;
                }
            }
            if (emptyCell) break;
        }

        if (!emptyCell) {
            return true;
        }

        const { row, col } = emptyCell;
        const possibleDigits = this.getPossibleDigitsForGrid(grid, row, col);

        for (const digit of possibleDigits) {
            grid[row][col] = digit;
            if (this.solve(grid)) {
                return true;
            }
            grid[row][col] = null;
        }

        return false;
    }

    getPossibleDigitsForGrid(grid, row, col) {
        // Use iterative constraint propagation for the grid
        const allPossible = this.computeAllPossibleDigitsForGrid(grid);
        return allPossible[row][col];
    }

    computeAllPossibleDigitsForGrid(grid) {
        // Initialize: for each cell, start with all digits not already in row/column
        const possible = [];
        for (let row = 0; row < this.size; row++) {
            possible[row] = [];
            for (let col = 0; col < this.size; col++) {
                if (grid[row][col] !== null) {
                    possible[row][col] = new Set([grid[row][col]]);
                } else {
                    possible[row][col] = new Set();
                    for (let d = 1; d <= this.size; d++) {
                        possible[row][col].add(d);
                    }
                    for (let c = 0; c < this.size; c++) {
                        if (grid[row][c] !== null) {
                            possible[row][col].delete(grid[row][c]);
                        }
                    }
                    for (let r = 0; r < this.size; r++) {
                        if (grid[r][col] !== null) {
                            possible[row][col].delete(grid[r][col]);
                        }
                    }
                }
            }
        }

        // Iteratively apply constraints until no changes
        let changed = true;
        while (changed) {
            changed = false;
            for (let row = 0; row < this.size; row++) {
                for (let col = 0; col < this.size; col++) {
                    if (this.applyConstraintsPropagationForGrid(row, col, possible)) {
                        changed = true;
                    }
                }
            }
        }

        return possible;
    }

    applyConstraintsPropagationForGrid(row, col, allPossible) {
        const myPossible = allPossible[row][col];
        if (myPossible.size === 0) return false;

        const sizeBefore = myPossible.size;
        const constraints = this.constraints[row][col];

        // For each direction where this cell > neighbor
        const greaterThan = [
            { hasConstraint: constraints.right, nRow: row, nCol: col + 1 },
            { hasConstraint: constraints.left, nRow: row, nCol: col - 1 },
            { hasConstraint: constraints.top, nRow: row - 1, nCol: col },
            { hasConstraint: constraints.bottom, nRow: row + 1, nCol: col }
        ];

        for (const { hasConstraint, nRow, nCol } of greaterThan) {
            if (hasConstraint && nRow >= 0 && nRow < this.size && nCol >= 0 && nCol < this.size) {
                const neighborPossible = allPossible[nRow][nCol];
                if (neighborPossible.size === 0 || myPossible.size === 0) continue;

                const neighborMin = Math.min(...neighborPossible);
                const myMax = Math.max(...myPossible);

                // Remove values from this cell that are <= neighbor's min
                for (let d = 1; d <= neighborMin; d++) {
                    myPossible.delete(d);
                }

                // Remove values from neighbor that are >= this cell's max
                for (let d = myMax; d <= this.size; d++) {
                    neighborPossible.delete(d);
                }
            }
        }

        // For each direction where neighbor > this cell
        const lessThan = [
            { nRow: row, nCol: col + 1, prop: 'left' },
            { nRow: row, nCol: col - 1, prop: 'right' },
            { nRow: row - 1, nCol: col, prop: 'bottom' },
            { nRow: row + 1, nCol: col, prop: 'top' }
        ];

        for (const { nRow, nCol, prop } of lessThan) {
            if (nRow >= 0 && nRow < this.size && nCol >= 0 && nCol < this.size) {
                if (this.constraints[nRow][nCol][prop]) {
                    const neighborPossible = allPossible[nRow][nCol];
                    if (neighborPossible.size === 0 || myPossible.size === 0) continue;

                    const neighborMax = Math.max(...neighborPossible);

                    // Remove values from this cell that are >= neighbor's max
                    for (let d = neighborMax; d <= this.size; d++) {
                        myPossible.delete(d);
                    }
                }
            }
        }

        // Multi-constraint propagation (same logic as applyMultiConstraintPropagation)
        this.applyMultiConstraintPropagation(row, col, allPossible);

        return myPossible.size !== sizeBefore;
    }

    // ========== ADVANCED SOLVING STRATEGIES ==========

    /**
     * Get all pencil marks (possible digits) for each empty cell
     * Returns a Map with key "row,col" and value Set of possible digits
     */
    getAllPencilMarks() {
        const pencilMarks = new Map();
        for (let row = 0; row < this.size; row++) {
            for (let col = 0; col < this.size; col++) {
                if (this.grid[row][col] === null) {
                    pencilMarks.set(`${row},${col}`, this.getPossibleDigits(row, col));
                }
            }
        }
        return pencilMarks;
    }

    /**
     * Naked Pairs Strategy:
     * If two cells in a row/column have identical pencilmarks with exactly 2 digits,
     * those digits can be eliminated from all other cells in that row/column.
     * Returns an object with eliminations made: { row, col, eliminated: Set } or null
     */
    findNakedPairs() {
        const pencilMarks = this.getAllPencilMarks();

        // Check rows
        for (let row = 0; row < this.size; row++) {
            const result = this.findNakedPairsInLine(pencilMarks, row, 'row');
            if (result) return result;
        }

        // Check columns
        for (let col = 0; col < this.size; col++) {
            const result = this.findNakedPairsInLine(pencilMarks, col, 'col');
            if (result) return result;
        }

        return null;
    }

    findNakedPairsInLine(pencilMarks, index, type) {
        // Get all cells in this line with exactly 2 candidates
        const pairCells = [];

        for (let i = 0; i < this.size; i++) {
            const row = type === 'row' ? index : i;
            const col = type === 'row' ? i : index;
            const key = `${row},${col}`;

            if (pencilMarks.has(key)) {
                const marks = pencilMarks.get(key);
                if (marks.size === 2) {
                    pairCells.push({ row, col, marks: [...marks].sort().join(',') });
                }
            }
        }

        // Find cells with identical pair marks
        for (let i = 0; i < pairCells.length; i++) {
            for (let j = i + 1; j < pairCells.length; j++) {
                if (pairCells[i].marks === pairCells[j].marks) {
                    // Found a naked pair! Now eliminate from other cells
                    const pairDigits = pairCells[i].marks.split(',').map(Number);
                    const pairPositions = new Set([
                        `${pairCells[i].row},${pairCells[i].col}`,
                        `${pairCells[j].row},${pairCells[j].col}`
                    ]);

                    // Check if any other cell in this line has these digits
                    for (let k = 0; k < this.size; k++) {
                        const row = type === 'row' ? index : k;
                        const col = type === 'row' ? k : index;
                        const key = `${row},${col}`;

                        if (!pairPositions.has(key) && pencilMarks.has(key)) {
                            const marks = pencilMarks.get(key);
                            const eliminated = new Set();

                            for (const digit of pairDigits) {
                                if (marks.has(digit)) {
                                    eliminated.add(digit);
                                }
                            }

                            if (eliminated.size > 0) {
                                return {
                                    type: 'nakedPair',
                                    pairCells: [pairCells[i], pairCells[j]],
                                    affectedCell: { row, col },
                                    eliminated,
                                    pairDigits
                                };
                            }
                        }
                    }
                }
            }
        }

        return null;
    }

    /**
     * Naked Triplets Strategy:
     * If 3 cells in a row/column together contain only 3 candidates total,
     * eliminate those 3 digits from all other cells in the line.
     */
    findNakedTriplets() {
        const pencilMarks = this.getAllPencilMarks();

        // Check rows
        for (let row = 0; row < this.size; row++) {
            const result = this.findNakedTripletsInLine(pencilMarks, row, 'row');
            if (result) return result;
        }

        // Check columns
        for (let col = 0; col < this.size; col++) {
            const result = this.findNakedTripletsInLine(pencilMarks, col, 'col');
            if (result) return result;
        }

        return null;
    }

    findNakedTripletsInLine(pencilMarks, index, type) {
        // Get all cells in this line with 2 or 3 candidates
        const candidateCells = [];

        for (let i = 0; i < this.size; i++) {
            const row = type === 'row' ? index : i;
            const col = type === 'row' ? i : index;
            const key = `${row},${col}`;

            if (pencilMarks.has(key)) {
                const marks = pencilMarks.get(key);
                if (marks.size >= 2 && marks.size <= 3) {
                    candidateCells.push({ row, col, marks: new Set(marks) });
                }
            }
        }

        // Find 3 cells whose combined candidates are exactly 3 digits
        for (let i = 0; i < candidateCells.length; i++) {
            for (let j = i + 1; j < candidateCells.length; j++) {
                for (let k = j + 1; k < candidateCells.length; k++) {
                    const combined = new Set([
                        ...candidateCells[i].marks,
                        ...candidateCells[j].marks,
                        ...candidateCells[k].marks
                    ]);

                    if (combined.size === 3) {
                        // Found a naked triplet! Eliminate from other cells
                        const tripletDigits = [...combined];
                        const tripletPositions = new Set([
                            `${candidateCells[i].row},${candidateCells[i].col}`,
                            `${candidateCells[j].row},${candidateCells[j].col}`,
                            `${candidateCells[k].row},${candidateCells[k].col}`
                        ]);

                        for (let m = 0; m < this.size; m++) {
                            const row = type === 'row' ? index : m;
                            const col = type === 'row' ? m : index;
                            const key = `${row},${col}`;

                            if (!tripletPositions.has(key) && pencilMarks.has(key)) {
                                const marks = pencilMarks.get(key);
                                const eliminated = new Set();

                                for (const digit of tripletDigits) {
                                    if (marks.has(digit)) {
                                        eliminated.add(digit);
                                    }
                                }

                                if (eliminated.size > 0) {
                                    return {
                                        type: 'nakedTriplet',
                                        tripletCells: [candidateCells[i], candidateCells[j], candidateCells[k]],
                                        affectedCell: { row, col },
                                        eliminated,
                                        tripletDigits
                                    };
                                }
                            }
                        }
                    }
                }
            }
        }

        return null;
    }

    /**
     * Naked Quadruplets Strategy:
     * If 4 cells in a row/column together contain only 4 candidates total,
     * eliminate those 4 digits from all other cells in the line.
     * Most useful for larger grids (7x7, 8x8, 9x9).
     */
    findNakedQuadruplets() {
        // Only useful for grids 7x7 or larger
        if (this.size < 7) return null;

        const pencilMarks = this.getAllPencilMarks();

        // Check rows
        for (let row = 0; row < this.size; row++) {
            const result = this.findNakedQuadrupletsInLine(pencilMarks, row, 'row');
            if (result) return result;
        }

        // Check columns
        for (let col = 0; col < this.size; col++) {
            const result = this.findNakedQuadrupletsInLine(pencilMarks, col, 'col');
            if (result) return result;
        }

        return null;
    }

    findNakedQuadrupletsInLine(pencilMarks, index, type) {
        // Get all cells in this line with 2, 3, or 4 candidates
        const candidateCells = [];

        for (let i = 0; i < this.size; i++) {
            const row = type === 'row' ? index : i;
            const col = type === 'row' ? i : index;
            const key = `${row},${col}`;

            if (pencilMarks.has(key)) {
                const marks = pencilMarks.get(key);
                if (marks.size >= 2 && marks.size <= 4) {
                    candidateCells.push({ row, col, marks: new Set(marks) });
                }
            }
        }

        // Find 4 cells whose combined candidates are exactly 4 digits
        for (let i = 0; i < candidateCells.length; i++) {
            for (let j = i + 1; j < candidateCells.length; j++) {
                for (let k = j + 1; k < candidateCells.length; k++) {
                    for (let l = k + 1; l < candidateCells.length; l++) {
                        const combined = new Set([
                            ...candidateCells[i].marks,
                            ...candidateCells[j].marks,
                            ...candidateCells[k].marks,
                            ...candidateCells[l].marks
                        ]);

                        if (combined.size === 4) {
                            // Found a naked quadruplet! Eliminate from other cells
                            const quadDigits = [...combined];
                            const quadPositions = new Set([
                                `${candidateCells[i].row},${candidateCells[i].col}`,
                                `${candidateCells[j].row},${candidateCells[j].col}`,
                                `${candidateCells[k].row},${candidateCells[k].col}`,
                                `${candidateCells[l].row},${candidateCells[l].col}`
                            ]);

                            for (let m = 0; m < this.size; m++) {
                                const row = type === 'row' ? index : m;
                                const col = type === 'row' ? m : index;
                                const key = `${row},${col}`;

                                if (!quadPositions.has(key) && pencilMarks.has(key)) {
                                    const marks = pencilMarks.get(key);
                                    const eliminated = new Set();

                                    for (const digit of quadDigits) {
                                        if (marks.has(digit)) {
                                            eliminated.add(digit);
                                        }
                                    }

                                    if (eliminated.size > 0) {
                                        return {
                                            type: 'nakedQuadruplet',
                                            quadCells: [candidateCells[i], candidateCells[j], candidateCells[k], candidateCells[l]],
                                            affectedCell: { row, col },
                                            eliminated,
                                            quadDigits
                                        };
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        return null;
    }

    /**
     * Hidden Pairs/Subsets Strategy:
     * If certain digits can only appear in a limited set of cells within a row/column,
     * other digits can be eliminated from those cells.
     * Example: If 1 and 3 only appear in cells A and B, remove all other digits from A and B.
     */
    findHiddenPairs() {
        const pencilMarks = this.getAllPencilMarks();

        // Check rows
        for (let row = 0; row < this.size; row++) {
            const result = this.findHiddenPairsInLine(pencilMarks, row, 'row');
            if (result) return result;
        }

        // Check columns
        for (let col = 0; col < this.size; col++) {
            const result = this.findHiddenPairsInLine(pencilMarks, col, 'col');
            if (result) return result;
        }

        return null;
    }

    findHiddenPairsInLine(pencilMarks, index, type) {
        // Build a map of digit -> cells where it can appear
        const digitToCells = new Map();

        for (let d = 1; d <= this.size; d++) {
            digitToCells.set(d, []);
        }

        for (let i = 0; i < this.size; i++) {
            const row = type === 'row' ? index : i;
            const col = type === 'row' ? i : index;
            const key = `${row},${col}`;

            // Skip filled cells
            if (this.grid[row][col] !== null) {
                digitToCells.delete(this.grid[row][col]);
                continue;
            }

            if (pencilMarks.has(key)) {
                const marks = pencilMarks.get(key);
                for (const digit of marks) {
                    if (digitToCells.has(digit)) {
                        digitToCells.get(digit).push({ row, col });
                    }
                }
            }
        }

        // Find pairs of digits that only appear in exactly 2 cells
        const digits = [...digitToCells.keys()];

        for (let i = 0; i < digits.length; i++) {
            for (let j = i + 1; j < digits.length; j++) {
                const d1 = digits[i];
                const d2 = digits[j];
                const cells1 = digitToCells.get(d1);
                const cells2 = digitToCells.get(d2);

                if (cells1.length === 2 && cells2.length === 2) {
                    // Check if they're the same 2 cells
                    const key1a = `${cells1[0].row},${cells1[0].col}`;
                    const key1b = `${cells1[1].row},${cells1[1].col}`;
                    const key2a = `${cells2[0].row},${cells2[0].col}`;
                    const key2b = `${cells2[1].row},${cells2[1].col}`;

                    if ((key1a === key2a && key1b === key2b) || (key1a === key2b && key1b === key2a)) {
                        // Found hidden pair! Check if we can eliminate other digits
                        const pairDigits = new Set([d1, d2]);

                        for (const cell of cells1) {
                            const key = `${cell.row},${cell.col}`;
                            const marks = pencilMarks.get(key);

                            if (marks && marks.size > 2) {
                                const eliminated = new Set();
                                for (const digit of marks) {
                                    if (!pairDigits.has(digit)) {
                                        eliminated.add(digit);
                                    }
                                }

                                if (eliminated.size > 0) {
                                    return {
                                        type: 'hiddenPair',
                                        pairDigits: [d1, d2],
                                        pairCells: cells1,
                                        affectedCell: cell,
                                        eliminated
                                    };
                                }
                            }
                        }
                    }
                }
            }
        }

        return null;
    }

    /**
     * Hidden Triplets Strategy:
     * If 3 digits can only appear in exactly 3 cells within a row/column,
     * eliminate all other digits from those 3 cells.
     */
    findHiddenTriplets() {
        const pencilMarks = this.getAllPencilMarks();

        // Check rows
        for (let row = 0; row < this.size; row++) {
            const result = this.findHiddenTripletsInLine(pencilMarks, row, 'row');
            if (result) return result;
        }

        // Check columns
        for (let col = 0; col < this.size; col++) {
            const result = this.findHiddenTripletsInLine(pencilMarks, col, 'col');
            if (result) return result;
        }

        return null;
    }

    findHiddenTripletsInLine(pencilMarks, index, type) {
        // Build a map of digit -> cells where it can appear
        const digitToCells = new Map();

        for (let d = 1; d <= this.size; d++) {
            digitToCells.set(d, []);
        }

        for (let i = 0; i < this.size; i++) {
            const row = type === 'row' ? index : i;
            const col = type === 'row' ? i : index;
            const key = `${row},${col}`;

            // Skip filled cells
            if (this.grid[row][col] !== null) {
                digitToCells.delete(this.grid[row][col]);
                continue;
            }

            if (pencilMarks.has(key)) {
                const marks = pencilMarks.get(key);
                for (const digit of marks) {
                    if (digitToCells.has(digit)) {
                        digitToCells.get(digit).push({ row, col });
                    }
                }
            }
        }

        // Find triplets of digits that appear in exactly 2 or 3 cells,
        // and those cells are the same 3 cells for all 3 digits
        const digits = [...digitToCells.keys()].filter(d => {
            const cells = digitToCells.get(d);
            return cells.length >= 2 && cells.length <= 3;
        });

        for (let i = 0; i < digits.length; i++) {
            for (let j = i + 1; j < digits.length; j++) {
                for (let k = j + 1; k < digits.length; k++) {
                    const d1 = digits[i];
                    const d2 = digits[j];
                    const d3 = digits[k];

                    // Collect all unique cells where these 3 digits appear
                    const cellSet = new Set();
                    for (const cell of digitToCells.get(d1)) {
                        cellSet.add(`${cell.row},${cell.col}`);
                    }
                    for (const cell of digitToCells.get(d2)) {
                        cellSet.add(`${cell.row},${cell.col}`);
                    }
                    for (const cell of digitToCells.get(d3)) {
                        cellSet.add(`${cell.row},${cell.col}`);
                    }

                    // If exactly 3 cells contain all 3 digits, it's a hidden triplet
                    if (cellSet.size === 3) {
                        const tripletDigits = new Set([d1, d2, d3]);
                        const tripletCells = [...cellSet].map(key => {
                            const [row, col] = key.split(',').map(Number);
                            return { row, col };
                        });

                        // Check if we can eliminate other digits from these cells
                        for (const cell of tripletCells) {
                            const key = `${cell.row},${cell.col}`;
                            const marks = pencilMarks.get(key);

                            if (marks && marks.size > 3) {
                                const eliminated = new Set();
                                for (const digit of marks) {
                                    if (!tripletDigits.has(digit)) {
                                        eliminated.add(digit);
                                    }
                                }

                                if (eliminated.size > 0) {
                                    return {
                                        type: 'hiddenTriplet',
                                        tripletDigits: [d1, d2, d3],
                                        tripletCells,
                                        affectedCell: cell,
                                        eliminated
                                    };
                                }
                            }
                        }
                    }
                }
            }
        }

        return null;
    }

    /**
     * Hidden Quadruplets Strategy:
     * If 4 digits can only appear in exactly 4 cells within a row/column,
     * eliminate all other digits from those 4 cells.
     * Most useful for larger grids (7x7, 8x8, 9x9).
     */
    findHiddenQuadruplets() {
        // Only useful for grids 7x7 or larger
        if (this.size < 7) return null;

        const pencilMarks = this.getAllPencilMarks();

        // Check rows
        for (let row = 0; row < this.size; row++) {
            const result = this.findHiddenQuadrupletsInLine(pencilMarks, row, 'row');
            if (result) return result;
        }

        // Check columns
        for (let col = 0; col < this.size; col++) {
            const result = this.findHiddenQuadrupletsInLine(pencilMarks, col, 'col');
            if (result) return result;
        }

        return null;
    }

    findHiddenQuadrupletsInLine(pencilMarks, index, type) {
        // Build a map of digit -> cells where it can appear
        const digitToCells = new Map();

        for (let d = 1; d <= this.size; d++) {
            digitToCells.set(d, []);
        }

        for (let i = 0; i < this.size; i++) {
            const row = type === 'row' ? index : i;
            const col = type === 'row' ? i : index;
            const key = `${row},${col}`;

            // Skip filled cells
            if (this.grid[row][col] !== null) {
                digitToCells.delete(this.grid[row][col]);
                continue;
            }

            if (pencilMarks.has(key)) {
                const marks = pencilMarks.get(key);
                for (const digit of marks) {
                    if (digitToCells.has(digit)) {
                        digitToCells.get(digit).push({ row, col });
                    }
                }
            }
        }

        // Find quadruplets of digits that appear in 2-4 cells,
        // and those cells are the same 4 cells for all 4 digits
        const digits = [...digitToCells.keys()].filter(d => {
            const cells = digitToCells.get(d);
            return cells.length >= 2 && cells.length <= 4;
        });

        for (let i = 0; i < digits.length; i++) {
            for (let j = i + 1; j < digits.length; j++) {
                for (let k = j + 1; k < digits.length; k++) {
                    for (let l = k + 1; l < digits.length; l++) {
                        const d1 = digits[i];
                        const d2 = digits[j];
                        const d3 = digits[k];
                        const d4 = digits[l];

                        // Collect all unique cells where these 4 digits appear
                        const cellSet = new Set();
                        for (const cell of digitToCells.get(d1)) {
                            cellSet.add(`${cell.row},${cell.col}`);
                        }
                        for (const cell of digitToCells.get(d2)) {
                            cellSet.add(`${cell.row},${cell.col}`);
                        }
                        for (const cell of digitToCells.get(d3)) {
                            cellSet.add(`${cell.row},${cell.col}`);
                        }
                        for (const cell of digitToCells.get(d4)) {
                            cellSet.add(`${cell.row},${cell.col}`);
                        }

                        // If exactly 4 cells contain all 4 digits, it's a hidden quadruplet
                        if (cellSet.size === 4) {
                            const quadDigits = new Set([d1, d2, d3, d4]);
                            const quadCells = [...cellSet].map(key => {
                                const [row, col] = key.split(',').map(Number);
                                return { row, col };
                            });

                            // Check if we can eliminate other digits from these cells
                            for (const cell of quadCells) {
                                const key = `${cell.row},${cell.col}`;
                                const marks = pencilMarks.get(key);

                                if (marks && marks.size > 4) {
                                    const eliminated = new Set();
                                    for (const digit of marks) {
                                        if (!quadDigits.has(digit)) {
                                            eliminated.add(digit);
                                        }
                                    }

                                    if (eliminated.size > 0) {
                                        return {
                                            type: 'hiddenQuadruplet',
                                            quadDigits: [d1, d2, d3, d4],
                                            quadCells,
                                            affectedCell: cell,
                                            eliminated
                                        };
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        return null;
    }

    /**
     * X-Wing Strategy:
     * If a digit appears in exactly 2 cells in each of 2 rows, and those cells
     * are in the same 2 columns, eliminate that digit from other cells in those columns.
     * (Also works with columns/rows reversed)
     */
    findXWing() {
        const pencilMarks = this.getAllPencilMarks();

        // Check for X-Wings in rows (eliminating from columns)
        for (let digit = 1; digit <= this.size; digit++) {
            const result = this.findXWingForDigit(pencilMarks, digit, 'row');
            if (result) return result;

            const result2 = this.findXWingForDigit(pencilMarks, digit, 'col');
            if (result2) return result2;
        }

        return null;
    }

    findXWingForDigit(pencilMarks, digit, type) {
        // Find all lines where this digit appears in exactly 2 cells
        const linesWithTwoCells = [];

        for (let i = 0; i < this.size; i++) {
            const cellsWithDigit = [];

            for (let j = 0; j < this.size; j++) {
                const row = type === 'row' ? i : j;
                const col = type === 'row' ? j : i;

                // Skip if cell is filled
                if (this.grid[row][col] !== null) continue;

                const key = `${row},${col}`;
                if (pencilMarks.has(key) && pencilMarks.get(key).has(digit)) {
                    cellsWithDigit.push({ row, col, pos: j });
                }
            }

            if (cellsWithDigit.length === 2) {
                linesWithTwoCells.push({
                    lineIndex: i,
                    cells: cellsWithDigit,
                    positions: [cellsWithDigit[0].pos, cellsWithDigit[1].pos].sort((a, b) => a - b).join(',')
                });
            }
        }

        // Find two lines with the same positions
        for (let i = 0; i < linesWithTwoCells.length; i++) {
            for (let j = i + 1; j < linesWithTwoCells.length; j++) {
                if (linesWithTwoCells[i].positions === linesWithTwoCells[j].positions) {
                    // Found X-Wing! Now check if we can eliminate from other cells
                    const pos1 = linesWithTwoCells[i].cells[0].pos;
                    const pos2 = linesWithTwoCells[i].cells[1].pos;

                    const xWingCells = new Set([
                        ...linesWithTwoCells[i].cells.map(c => `${c.row},${c.col}`),
                        ...linesWithTwoCells[j].cells.map(c => `${c.row},${c.col}`)
                    ]);

                    // Check perpendicular lines (columns if we found row X-Wing, rows if column X-Wing)
                    for (const crossPos of [pos1, pos2]) {
                        for (let k = 0; k < this.size; k++) {
                            const row = type === 'row' ? k : crossPos;
                            const col = type === 'row' ? crossPos : k;
                            const key = `${row},${col}`;

                            if (!xWingCells.has(key) && pencilMarks.has(key)) {
                                const marks = pencilMarks.get(key);
                                if (marks.has(digit)) {
                                    return {
                                        type: 'xWing',
                                        digit,
                                        xWingCells: [...xWingCells],
                                        affectedCell: { row, col },
                                        eliminated: new Set([digit])
                                    };
                                }
                            }
                        }
                    }
                }
            }
        }

        return null;
    }

    /**
     * Apply all advanced strategies and return any elimination found
     */
    applyAdvancedStrategies() {
        // Try Naked Pairs
        const nakedPair = this.findNakedPairs();
        if (nakedPair) return nakedPair;

        // Try Hidden Pairs
        const hiddenPair = this.findHiddenPairs();
        if (hiddenPair) return hiddenPair;

        // Try Naked Triplets
        const nakedTriplet = this.findNakedTriplets();
        if (nakedTriplet) return nakedTriplet;

        // Try Hidden Triplets
        const hiddenTriplet = this.findHiddenTriplets();
        if (hiddenTriplet) return hiddenTriplet;

        // Try Naked Quadruplets (7x7 and larger)
        const nakedQuadruplet = this.findNakedQuadruplets();
        if (nakedQuadruplet) return nakedQuadruplet;

        // Try Hidden Quadruplets (7x7 and larger)
        const hiddenQuadruplet = this.findHiddenQuadruplets();
        if (hiddenQuadruplet) return hiddenQuadruplet;

        // Try X-Wing
        const xWing = this.findXWing();
        if (xWing) return xWing;

        return null;
    }

    updateSolvabilityDisplay(isSolvable, isComplete, stats = null) {
        let statusText = '';
        let statsText = '';

        if (stats && stats.steps > 0) {
            statsText = ` (${stats.steps} steps, ${stats.timeMs.toFixed(1)}ms)`;
        }

        if (isComplete) {
            statusText = 'Solved!';
            this.solvabilityStatus.className = 'solvability-status solved';
            this.onGameCompleted();
            this.launchFireworks();
        } else if (isSolvable) {
            statusText = 'Solvable' + statsText;
            this.solvabilityStatus.className = 'solvability-status solvable';
        } else {
            if (this.solveGaveUp) {
                statusText = 'Gave up' + statsText;
            } else {
                statusText = 'Not solvable' + statsText;
            }
            this.solvabilityStatus.className = 'solvability-status unsolvable';
        }

        this.solvabilityStatus.textContent = statusText;
    }

    startPuzzleGeneration(difficulty) {
        this.size = parseInt(this.sizeSelect.value);
        this.difficulty = difficulty;
        this.entryMode = false;
        this.resetGameState();
        this.generationCancelled = false;
        this.useCurrentBest = false;
        this.currentBestPuzzle = null;

        // Show progress bar immediately, hide "Use Best" button initially
        this.generationProgress.classList.remove('hidden');
        this.progressBar.style.width = '0%';
        this.progressAttempts.textContent = '0';
        this.progressTime.textContent = '0';
        this.progressBest.classList.add('hidden');
        this.useBestBtn.classList.add('hidden');

        // Use requestAnimationFrame to ensure the progress dialog is rendered
        // before starting the heavy computation
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                this.generatePuzzleAsync(difficulty);
            });
        });
    }

    useBestPuzzle() {
        // Immediately apply the stored best puzzle and terminate the worker
        if (this.currentBestPuzzle) {
            // Clear the progress interval
            if (this.generationProgressInterval) {
                clearInterval(this.generationProgressInterval);
                this.generationProgressInterval = null;
            }
            // Terminate the worker to stop generation immediately
            if (this.generatorWorker) {
                this.generatorWorker.terminate();
                this.generatorWorker = null;
            }
            this.generationProgress.classList.add('hidden');
            this.applyGeneratedPuzzle(this.currentBestPuzzle.grid, this.currentBestPuzzle.constraints);
            this.currentBestPuzzle = null;
        }
    }

    cancelGeneration() {
        this.generationCancelled = true;
        if (this.generatorWorker) {
            this.generatorWorker.postMessage({ type: 'cancel' });
        }
        this.generationProgress.classList.add('hidden');
    }

    generatePuzzleAsync(difficulty) {
        this.generationStartTime = Date.now();

        // Create worker if it doesn't exist
        if (!this.generatorWorker) {
            this.generatorWorker = new Worker('generator-worker.js');
        }

        // Update progress bar based on elapsed time
        const updateProgressBar = () => {
            if (this.generationCancelled) return;
            const elapsed = Math.floor((Date.now() - this.generationStartTime) / 1000);
            const progress = Math.min(100, (elapsed / 30) * 100);
            this.progressBar.style.width = `${progress}%`;
            this.progressTime.textContent = elapsed.toString();
        };

        // Update progress every 100ms
        this.generationProgressInterval = setInterval(updateProgressBar, 100);

        // Set up message handler
        this.generatorWorker.onmessage = (e) => {
            const { type } = e.data;

            switch (type) {
                case 'progress': {
                    const { attempts, bestHintCount, bestGrid, bestConstraints } = e.data;
                    this.progressAttempts.textContent = attempts.toString();
                    if (bestHintCount !== null) {
                        this.progressBestHints.textContent = bestHintCount.toString();
                        this.progressBest.classList.remove('hidden');
                        this.useBestBtn.classList.remove('hidden');
                        // Store best puzzle for immediate use when "Use Best" is clicked
                        if (bestGrid && bestConstraints) {
                            this.currentBestPuzzle = { grid: bestGrid, constraints: bestConstraints };
                        }
                    }
                    break;
                }

                case 'complete': {
                    clearInterval(this.generationProgressInterval);
                    this.generationProgress.classList.add('hidden');

                    const { grid, constraints } = e.data;
                    this.applyGeneratedPuzzle(grid, constraints);
                    break;
                }

                case 'cancelled': {
                    clearInterval(this.generationProgressInterval);
                    this.generationProgress.classList.add('hidden');
                    // If user wanted to use current best but there was none, show message
                    if (this.useCurrentBest) {
                        alert('No valid puzzle has been found yet. Please try again.');
                    }
                    break;
                }

                case 'error': {
                    clearInterval(this.generationProgressInterval);
                    this.generationProgress.classList.add('hidden');
                    alert(e.data.message + ' Please try again.');
                    break;
                }
            }
        };

        this.generatorWorker.onerror = (error) => {
            clearInterval(this.generationProgressInterval);
            this.generationProgress.classList.add('hidden');
            console.error('Generator worker error:', error);
            alert('An error occurred during puzzle generation. Please try again.');
        };

        // Start generation
        this.generatorWorker.postMessage({
            type: 'generate',
            data: { size: this.size, difficulty }
        });
    }

    applyGeneratedPuzzle(grid, constraints) {
        // Use the generated puzzle
        this.grid = grid;
        this.constraints = constraints;
        this.givenCells = new Set();

        // Mark all filled cells as givens
        for (let row = 0; row < this.size; row++) {
            for (let col = 0; col < this.size; col++) {
                if (this.grid[row][col] !== null) {
                    this.givenCells.add(`${row},${col}`);
                }
            }
        }

        // Render and show the game
        this.renderGrid();
        this.syncGridDisplay();
        this.setupElement.classList.add('hidden');
        this.entryControlsElement.classList.add('hidden');
        this.controlsElement.classList.remove('hidden');
        this.gameContainer.classList.remove('hidden');
        this.solvabilityStatus.classList.remove('hidden');
        this.gameCounters.classList.remove('hidden');
        this.inputRow.classList.remove('hidden');
        this.updateConstraintIndicators();
        this.onGameStarted();
        this.checkSolvability();
    }

    /**
     * Generate a puzzle that requires the specified difficulty level to solve.
     * Tries to remove as many digits as possible while maintaining solvability.
     */
    generatePuzzleForDifficulty(solution, difficulty) {
        // Start with all cells filled, then remove digits while maintaining solvability
        for (let row = 0; row < this.size; row++) {
            for (let col = 0; col < this.size; col++) {
                this.grid[row][col] = solution[row][col];
            }
        }

        // Get all positions and shuffle them
        const positions = [];
        for (let row = 0; row < this.size; row++) {
            for (let col = 0; col < this.size; col++) {
                positions.push({ row, col });
            }
        }
        this.shuffleArray(positions);

        // Try to remove each digit - no limit, remove as many as possible
        for (const { row, col } of positions) {
            const backup = this.grid[row][col];
            this.grid[row][col] = null;

            // Check if puzzle is solvable at this difficulty
            const analysis = this.analyzePuzzleDifficulty();

            if (!analysis.solvable) {
                // Puzzle became unsolvable, restore the digit
                this.grid[row][col] = backup;
            } else if (difficulty === 'easy' && analysis.maxStrategyRequired !== 'nakedSingle') {
                // Easy puzzle requires more than naked singles, restore
                this.grid[row][col] = backup;
            } else if (difficulty === 'medium' && analysis.maxStrategyRequired === 'xWing') {
                // Medium puzzle requires X-Wing (too hard), restore
                this.grid[row][col] = backup;
            }
            // Otherwise removal is acceptable
        }

        // For medium and hard, verify we actually need the advanced strategies
        const finalAnalysis = this.analyzePuzzleDifficulty();

        if (difficulty === 'medium') {
            // Medium should require at least hidden singles or pairs
            if (finalAnalysis.maxStrategyRequired === 'nakedSingle') {
                // Too easy - this puzzle doesn't work for medium
                return false;
            }
        } else if (difficulty === 'hard') {
            // Hard should require X-Wings
            if (finalAnalysis.maxStrategyRequired !== 'xWing') {
                // Not hard enough - this puzzle doesn't work for hard
                return false;
            }
        }

        return finalAnalysis.solvable;
    }

    /**
     * Analyze what strategies are needed to solve the current puzzle
     * Returns { solvable: boolean, maxStrategyRequired: string }
     */
    analyzePuzzleDifficulty() {
        // Make a copy of the grid
        const originalGrid = this.grid;
        const workingGrid = originalGrid.map(row => [...row]);
        this.grid = workingGrid;

        let maxStrategy = 'nakedSingle';
        let solved = false;
        let maxSteps = this.size * this.size * 2;

        while (maxSteps > 0) {
            maxSteps--;

            // Count empty cells
            let emptyCells = 0;
            for (let row = 0; row < this.size; row++) {
                for (let col = 0; col < this.size; col++) {
                    if (this.grid[row][col] === null) emptyCells++;
                }
            }

            if (emptyCells === 0) {
                solved = true;
                break;
            }

            // Try naked singles first
            let madeProgress = false;
            for (let row = 0; row < this.size; row++) {
                for (let col = 0; col < this.size; col++) {
                    if (this.grid[row][col] === null) {
                        const possible = this.getPossibleDigits(row, col);
                        if (possible.size === 0) {
                            // Invalid state
                            this.grid = originalGrid;
                            return { solvable: false, maxStrategyRequired: maxStrategy };
                        }
                        if (possible.size === 1) {
                            this.grid[row][col] = [...possible][0];
                            madeProgress = true;
                        }
                    }
                }
            }
            if (madeProgress) continue;

            // Try hidden singles
            const hiddenSingle = this.findHiddenSingle();
            if (hiddenSingle) {
                this.grid[hiddenSingle.row][hiddenSingle.col] = hiddenSingle.digit;
                if (maxStrategy === 'nakedSingle') maxStrategy = 'hiddenSingle';
                continue;
            }

            // Try naked pairs
            const nakedPair = this.findNakedPairs();
            if (nakedPair) {
                // Naked pairs eliminate candidates but don't place digits directly
                // We need to continue and see if this leads to singles
                if (maxStrategy === 'nakedSingle' || maxStrategy === 'hiddenSingle') {
                    maxStrategy = 'nakedPair';
                }
                // Re-check for singles after elimination knowledge
                continue;
            }

            // Try hidden pairs
            const hiddenPair = this.findHiddenPairs();
            if (hiddenPair) {
                if (maxStrategy === 'nakedSingle' || maxStrategy === 'hiddenSingle' || maxStrategy === 'nakedPair') {
                    maxStrategy = 'hiddenPair';
                }
                continue;
            }

            // Try X-Wing
            const xWing = this.findXWing();
            if (xWing) {
                maxStrategy = 'xWing';
                continue;
            }

            // No strategy worked - puzzle is stuck (not solvable without guessing)
            this.grid = originalGrid;
            return { solvable: false, maxStrategyRequired: maxStrategy };
        }

        this.grid = originalGrid;
        return { solvable: solved, maxStrategyRequired: maxStrategy };
    }

    syncGridDisplay() {
        // Update the input elements to show the current grid values
        for (let row = 0; row < this.size; row++) {
            for (let col = 0; col < this.size; col++) {
                const input = this.gridElement.querySelector(
                    `.cell-input[data-row="${row}"][data-col="${col}"]`
                );
                if (input) {
                    const value = this.grid[row][col];
                    if (value !== null) {
                        input.value = value;
                        input.classList.add('has-value');
                        // Only mark as given if it's in the givenCells set
                        if (this.givenCells.has(`${row},${col}`)) {
                            input.classList.add('given');
                        }
                    } else {
                        input.value = '';
                        input.classList.remove('has-value', 'given');
                    }
                }
            }
        }
    }

    generateSolution() {
        // Create an empty grid and fill it with a valid Latin square
        const solution = [];
        for (let row = 0; row < this.size; row++) {
            solution[row] = new Array(this.size).fill(null);
        }

        // Use backtracking to generate a random valid solution
        if (this.fillSolutionGrid(solution, 0, 0)) {
            return solution;
        }
        return null;
    }

    fillSolutionGrid(grid, row, col) {
        if (row >= this.size) {
            return true; // All cells filled
        }

        const nextCol = (col + 1) % this.size;
        const nextRow = nextCol === 0 ? row + 1 : row;

        // Get available digits and shuffle them for randomness
        const available = this.getAvailableDigits(grid, row, col);
        this.shuffleArray(available);

        for (const digit of available) {
            grid[row][col] = digit;
            if (this.fillSolutionGrid(grid, nextRow, nextCol)) {
                return true;
            }
            grid[row][col] = null;
        }

        return false;
    }

    getAvailableDigits(grid, row, col) {
        const used = new Set();

        // Check row
        for (let c = 0; c < this.size; c++) {
            if (grid[row][c] !== null) {
                used.add(grid[row][c]);
            }
        }

        // Check column
        for (let r = 0; r < this.size; r++) {
            if (grid[r][col] !== null) {
                used.add(grid[r][col]);
            }
        }

        const available = [];
        for (let d = 1; d <= this.size; d++) {
            if (!used.has(d)) {
                available.push(d);
            }
        }

        return available;
    }

    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }

    addConstraintsFromSolution(solution, difficulty = 'easy') {
        // Add constraints between adjacent cells based on the solution
        // Harder puzzles get fewer constraints to make them more challenging
        let constraintProbability;
        switch (difficulty) {
            case 'easy':
                constraintProbability = 0.6 + Math.random() * 0.2; // 60-80%
                break;
            case 'medium':
                constraintProbability = 0.4 + Math.random() * 0.2; // 40-60%
                break;
            case 'hard':
                constraintProbability = 0.25 + Math.random() * 0.15; // 25-40%
                break;
            default:
                constraintProbability = 0.5;
        }

        for (let row = 0; row < this.size; row++) {
            for (let col = 0; col < this.size; col++) {
                // Check right neighbor
                if (col + 1 < this.size && Math.random() < constraintProbability) {
                    if (solution[row][col] > solution[row][col + 1]) {
                        this.constraints[row][col].right = true;
                    } else {
                        this.constraints[row][col + 1].left = true;
                    }
                }

                // Check bottom neighbor
                if (row + 1 < this.size && Math.random() < constraintProbability) {
                    if (solution[row][col] > solution[row + 1][col]) {
                        this.constraints[row][col].bottom = true;
                    } else {
                        this.constraints[row + 1][col].top = true;
                    }
                }
            }
        }
    }

    /**
     * Solve using logic strategies only (no backtracking/guessing)
     * Returns true if a step was made, false if stuck
     */
    solveOneStepLogically() {
        // 1. Try naked singles
        for (let row = 0; row < this.size; row++) {
            for (let col = 0; col < this.size; col++) {
                if (this.grid[row][col] === null) {
                    const possible = this.getPossibleDigits(row, col);
                    if (possible.size === 1) {
                        this.grid[row][col] = [...possible][0];
                        return { type: 'nakedSingle', row, col, digit: this.grid[row][col] };
                    }
                }
            }
        }

        // 2. Try hidden singles
        const hiddenSingle = this.findHiddenSingle();
        if (hiddenSingle) {
            this.grid[hiddenSingle.row][hiddenSingle.col] = hiddenSingle.digit;
            return { type: 'hiddenSingle', ...hiddenSingle };
        }

        // 3. Advanced strategies return elimination info but don't place digits
        // They're useful for hints but the solver uses backtracking when stuck
        return null;
    }

    // ========== FIREWORKS CELEBRATION ==========

    launchFireworks() {
        // Don't launch if already celebrating
        if (document.querySelector('.fireworks-container')) {
            return;
        }

        const container = document.createElement('div');
        container.className = 'fireworks-container';
        document.body.appendChild(container);

        const colors = ['#ff6b6b', '#4ecdc4', '#ffe66d', '#95e1d3', '#f38181', '#aa96da', '#fcbad3', '#a8d8ea'];

        // Launch multiple fireworks over time
        const launchCount = 8;
        for (let i = 0; i < launchCount; i++) {
            setTimeout(() => {
                this.createFirework(container, colors);
            }, i * 300);
        }

        // Remove container after animation completes
        setTimeout(() => {
            container.remove();
        }, 4000);
    }

    createFirework(container, colors) {
        const x = Math.random() * window.innerWidth;
        const endY = window.innerHeight * 0.2 + Math.random() * window.innerHeight * 0.3;
        const color = colors[Math.floor(Math.random() * colors.length)];

        // Create rising firework
        const firework = document.createElement('div');
        firework.className = 'firework';
        firework.style.left = x + 'px';
        firework.style.bottom = '0px';
        firework.style.background = color;
        firework.style.boxShadow = `0 0 6px ${color}`;
        container.appendChild(firework);

        // After rise, create explosion
        setTimeout(() => {
            firework.remove();
            this.createExplosion(container, x, endY, color);
        }, 800);
    }

    createExplosion(container, x, y, color) {
        const particleCount = 20 + Math.floor(Math.random() * 15);

        for (let i = 0; i < particleCount; i++) {
            const particle = document.createElement('div');
            particle.className = 'firework-particle';
            particle.style.left = x + 'px';
            particle.style.top = y + 'px';
            particle.style.background = color;
            particle.style.boxShadow = `0 0 4px ${color}`;

            // Random direction for explosion
            const angle = (Math.PI * 2 * i) / particleCount + (Math.random() - 0.5) * 0.5;
            const distance = 50 + Math.random() * 100;
            const tx = Math.cos(angle) * distance;
            const ty = Math.sin(angle) * distance + 30; // Add gravity effect

            particle.style.setProperty('--tx', tx + 'px');
            particle.style.setProperty('--ty', ty + 'px');

            container.appendChild(particle);

            // Remove particle after animation
            setTimeout(() => {
                particle.remove();
            }, 1000);
        }
    }
}

// Initialize the game when the DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new FutoshikiGame();
});
