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

class FutoshikiGame {
    constructor() {
        this.size = 5;
        this.grid = [];
        this.constraints = [];
        this.autoDigitsEnabled = false;
        this.selectedCell = null;
        this.entryMode = false;
        this.givenCells = new Set();

        this.setupElement = document.getElementById('setup');
        this.controlsElement = document.getElementById('controls');
        this.entryControlsElement = document.getElementById('entry-controls');
        this.gameContainer = document.getElementById('game-container');
        this.gridElement = document.getElementById('grid');
        this.sizeSelect = document.getElementById('size-select');
        this.startBtn = document.getElementById('start-btn');
        this.newGameBtn = document.getElementById('new-game-btn');
        this.autoDigitsBtn = document.getElementById('auto-digits-btn');
        this.hintBtn = document.getElementById('hint-btn');
        this.solvabilityStatus = document.getElementById('solvability-status');
        this.generateBtn = document.getElementById('generate-btn');
        this.entryDoneBtn = document.getElementById('entry-done-btn');
        this.entryCancelBtn = document.getElementById('entry-cancel-btn');

        this.bindEvents();
    }

    bindEvents() {
        this.startBtn.addEventListener('click', () => this.startEntryMode());
        this.newGameBtn.addEventListener('click', () => this.showSetup());
        this.autoDigitsBtn.addEventListener('click', () => this.toggleAutoDigits());
        this.hintBtn.addEventListener('click', () => this.showHint());
        this.generateBtn.addEventListener('click', () => this.generatePuzzle());
        this.entryDoneBtn.addEventListener('click', () => this.finishEntry());
        this.entryCancelBtn.addEventListener('click', () => this.showSetup());
    }

    startEntryMode() {
        this.size = parseInt(this.sizeSelect.value);
        this.initializeGrid();
        this.entryMode = true;
        this.givenCells = new Set();
        this.renderGrid();
        this.setupElement.classList.add('hidden');
        this.entryControlsElement.classList.remove('hidden');
        this.controlsElement.classList.add('hidden');
        this.gameContainer.classList.remove('hidden');
        this.solvabilityStatus.classList.remove('hidden');
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
        this.autoDigitsEnabled = false;
        this.autoDigitsBtn.textContent = 'Auto Digits: OFF';
        this.autoDigitsBtn.classList.remove('active');
        this.entryMode = false;
        this.givenCells = new Set();
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
        this.gridElement.style.gridTemplateColumns = `repeat(${this.size}, 50px)`;
        this.gridElement.style.gridTemplateRows = `repeat(${this.size}, 50px)`;

        for (let row = 0; row < this.size; row++) {
            for (let col = 0; col < this.size; col++) {
                const cell = this.createCell(row, col);
                this.gridElement.appendChild(cell);
            }
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

        // Handle constraint keys
        if (['L', 'R', 'T', 'B'].includes(key)) {
            e.preventDefault();
            this.toggleConstraint(row, col, key);
            return;
        }

        // Handle delete/backspace
        if (e.key === 'Delete' || e.key === 'Backspace') {
            this.grid[row][col] = null;
            e.target.value = '';
            e.target.classList.remove('has-value');
            this.updateAutoDigits();
            this.checkSolvability();
            return;
        }

        // Handle arrow keys for navigation
        if (e.key.startsWith('Arrow')) {
            e.preventDefault();
            this.navigateGrid(row, col, e.key);
            return;
        }

        // Handle digit keys - allow direct overwrite
        const num = parseInt(e.key);
        if (num >= 1 && num <= this.size) {
            e.preventDefault();
            this.grid[row][col] = num;
            e.target.value = num;
            e.target.classList.add('has-value');
            this.updateAutoDigits();
            this.checkSolvability();
            return;
        }

        // Block other character input
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
        }
    }

    onInput(e, row, col) {
        // Handle paste or other input methods
        const value = e.target.value;
        const num = parseInt(value.slice(-1)); // Get last character for paste handling

        if (num >= 1 && num <= this.size) {
            this.grid[row][col] = num;
            e.target.value = num;
            e.target.classList.add('has-value');
        } else {
            this.grid[row][col] = null;
            e.target.value = '';
            e.target.classList.remove('has-value');
        }

        this.updateAutoDigits();
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
                input.style.background = this.grid[row][col] !== null ? '#ebf8ff' : 'white';
                return;
            }

            const possibleDigits = this.getPossibleDigits(row, col);
            autoDigitsContainer.style.display = 'grid';
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
        const possible = new Set();
        for (let d = 1; d <= this.size; d++) {
            possible.add(d);
        }

        // Remove digits already in the same row
        for (let c = 0; c < this.size; c++) {
            if (c !== col && this.grid[row][c] !== null) {
                possible.delete(this.grid[row][c]);
            }
        }

        // Remove digits already in the same column
        for (let r = 0; r < this.size; r++) {
            if (r !== row && this.grid[r][col] !== null) {
                possible.delete(this.grid[r][col]);
            }
        }

        // Apply constraint rules
        this.applyConstraints(row, col, possible);

        return possible;
    }

    applyConstraints(row, col, possible) {
        const constraints = this.constraints[row][col];

        // This cell has constraint pointing to another cell (this > other)
        // Check right: this cell > right cell
        if (constraints.right && col + 1 < this.size) {
            const otherVal = this.grid[row][col + 1];
            if (otherVal !== null) {
                // This cell must be > otherVal, so remove 1..otherVal
                for (let d = 1; d <= otherVal; d++) {
                    possible.delete(d);
                }
            }
        }

        // Check left: this cell > left cell
        if (constraints.left && col - 1 >= 0) {
            const otherVal = this.grid[row][col - 1];
            if (otherVal !== null) {
                for (let d = 1; d <= otherVal; d++) {
                    possible.delete(d);
                }
            }
        }

        // Check top: this cell > top cell
        if (constraints.top && row - 1 >= 0) {
            const otherVal = this.grid[row - 1][col];
            if (otherVal !== null) {
                for (let d = 1; d <= otherVal; d++) {
                    possible.delete(d);
                }
            }
        }

        // Check bottom: this cell > bottom cell
        if (constraints.bottom && row + 1 < this.size) {
            const otherVal = this.grid[row + 1][col];
            if (otherVal !== null) {
                for (let d = 1; d <= otherVal; d++) {
                    possible.delete(d);
                }
            }
        }

        // Now check constraints pointing TO this cell (other > this)
        // Check if right cell has left constraint pointing to us
        if (col + 1 < this.size && this.constraints[row][col + 1].left) {
            const otherVal = this.grid[row][col + 1];
            if (otherVal !== null) {
                // Right cell > this cell, so this must be < otherVal
                for (let d = otherVal; d <= this.size; d++) {
                    possible.delete(d);
                }
            }
        }

        // Check if left cell has right constraint pointing to us
        if (col - 1 >= 0 && this.constraints[row][col - 1].right) {
            const otherVal = this.grid[row][col - 1];
            if (otherVal !== null) {
                for (let d = otherVal; d <= this.size; d++) {
                    possible.delete(d);
                }
            }
        }

        // Check if top cell has bottom constraint pointing to us
        if (row - 1 >= 0 && this.constraints[row - 1][col].bottom) {
            const otherVal = this.grid[row - 1][col];
            if (otherVal !== null) {
                for (let d = otherVal; d <= this.size; d++) {
                    possible.delete(d);
                }
            }
        }

        // Check if bottom cell has top constraint pointing to us
        if (row + 1 < this.size && this.constraints[row + 1][col].top) {
            const otherVal = this.grid[row + 1][col];
            if (otherVal !== null) {
                for (let d = otherVal; d <= this.size; d++) {
                    possible.delete(d);
                }
            }
        }

        // Advanced: consider constraints even when other cell is empty
        // Count how many cells could be smaller/larger
        this.applyAdvancedConstraints(row, col, possible);
    }

    applyAdvancedConstraints(row, col, possible) {
        const constraints = this.constraints[row][col];

        // Count constraints where this cell must be greater
        let mustBeGreaterThanCount = 0;
        // Count constraints where this cell must be less than
        let mustBeLessThanCount = 0;

        // This cell > other (constraint pointing away)
        if (constraints.right && col + 1 < this.size) mustBeGreaterThanCount++;
        if (constraints.left && col - 1 >= 0) mustBeGreaterThanCount++;
        if (constraints.top && row - 1 >= 0) mustBeGreaterThanCount++;
        if (constraints.bottom && row + 1 < this.size) mustBeGreaterThanCount++;

        // Other cell > this cell (constraint pointing to us)
        if (col + 1 < this.size && this.constraints[row][col + 1].left) mustBeLessThanCount++;
        if (col - 1 >= 0 && this.constraints[row][col - 1].right) mustBeLessThanCount++;
        if (row - 1 >= 0 && this.constraints[row - 1][col].bottom) mustBeLessThanCount++;
        if (row + 1 < this.size && this.constraints[row + 1][col].top) mustBeLessThanCount++;

        // If this cell must be greater than N cells, it must be at least N+1
        if (mustBeGreaterThanCount > 0) {
            for (let d = 1; d <= mustBeGreaterThanCount; d++) {
                possible.delete(d);
            }
        }

        // If this cell must be less than N cells, it must be at most size-N
        if (mustBeLessThanCount > 0) {
            for (let d = this.size - mustBeLessThanCount + 1; d <= this.size; d++) {
                possible.delete(d);
            }
        }
    }

    showHint() {
        // Clear any existing hint highlight
        this.clearHintHighlight();

        // Find a cell that has exactly one possible digit
        for (let row = 0; row < this.size; row++) {
            for (let col = 0; col < this.size; col++) {
                if (this.grid[row][col] === null) {
                    const possibleDigits = this.getPossibleDigits(row, col);
                    if (possibleDigits.size === 1) {
                        this.highlightHintCell(row, col);
                        return;
                    }
                }
            }
        }

        // No solvable cell found - briefly flash the hint button to indicate this
        this.hintBtn.classList.add('no-hint');
        setTimeout(() => {
            this.hintBtn.classList.remove('no-hint');
        }, 500);
    }

    highlightHintCell(row, col) {
        const input = this.gridElement.querySelector(
            `.cell-input[data-row="${row}"][data-col="${col}"]`
        );
        if (input) {
            input.classList.add('hint-highlight');
            input.focus();
        }
    }

    clearHintHighlight() {
        const highlighted = this.gridElement.querySelectorAll('.hint-highlight');
        highlighted.forEach(el => el.classList.remove('hint-highlight'));
    }

    checkSolvability() {
        // Create a copy of the grid for solving
        const gridCopy = this.grid.map(row => [...row]);
        const isSolvable = this.solve(gridCopy);

        // Check if puzzle is complete
        const isComplete = this.grid.every(row => row.every(cell => cell !== null));

        this.updateSolvabilityDisplay(isSolvable, isComplete);
    }

    solve(grid) {
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

        // If no empty cell, puzzle is solved
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
        const possible = new Set();
        for (let d = 1; d <= this.size; d++) {
            possible.add(d);
        }

        // Remove digits already in the same row
        for (let c = 0; c < this.size; c++) {
            if (c !== col && grid[row][c] !== null) {
                possible.delete(grid[row][c]);
            }
        }

        // Remove digits already in the same column
        for (let r = 0; r < this.size; r++) {
            if (r !== row && grid[r][col] !== null) {
                possible.delete(grid[r][col]);
            }
        }

        // Apply constraint rules using the grid copy
        this.applyConstraintsForGrid(grid, row, col, possible);

        return possible;
    }

    applyConstraintsForGrid(grid, row, col, possible) {
        const constraints = this.constraints[row][col];

        // This cell has constraint pointing to another cell (this > other)
        if (constraints.right && col + 1 < this.size) {
            const otherVal = grid[row][col + 1];
            if (otherVal !== null) {
                for (let d = 1; d <= otherVal; d++) {
                    possible.delete(d);
                }
            }
        }

        if (constraints.left && col - 1 >= 0) {
            const otherVal = grid[row][col - 1];
            if (otherVal !== null) {
                for (let d = 1; d <= otherVal; d++) {
                    possible.delete(d);
                }
            }
        }

        if (constraints.top && row - 1 >= 0) {
            const otherVal = grid[row - 1][col];
            if (otherVal !== null) {
                for (let d = 1; d <= otherVal; d++) {
                    possible.delete(d);
                }
            }
        }

        if (constraints.bottom && row + 1 < this.size) {
            const otherVal = grid[row + 1][col];
            if (otherVal !== null) {
                for (let d = 1; d <= otherVal; d++) {
                    possible.delete(d);
                }
            }
        }

        // Constraints pointing TO this cell (other > this)
        if (col + 1 < this.size && this.constraints[row][col + 1].left) {
            const otherVal = grid[row][col + 1];
            if (otherVal !== null) {
                for (let d = otherVal; d <= this.size; d++) {
                    possible.delete(d);
                }
            }
        }

        if (col - 1 >= 0 && this.constraints[row][col - 1].right) {
            const otherVal = grid[row][col - 1];
            if (otherVal !== null) {
                for (let d = otherVal; d <= this.size; d++) {
                    possible.delete(d);
                }
            }
        }

        if (row - 1 >= 0 && this.constraints[row - 1][col].bottom) {
            const otherVal = grid[row - 1][col];
            if (otherVal !== null) {
                for (let d = otherVal; d <= this.size; d++) {
                    possible.delete(d);
                }
            }
        }

        if (row + 1 < this.size && this.constraints[row + 1][col].top) {
            const otherVal = grid[row + 1][col];
            if (otherVal !== null) {
                for (let d = otherVal; d <= this.size; d++) {
                    possible.delete(d);
                }
            }
        }

        // Apply advanced constraints
        this.applyAdvancedConstraintsForGrid(row, col, possible);
    }

    applyAdvancedConstraintsForGrid(row, col, possible) {
        const constraints = this.constraints[row][col];

        let mustBeGreaterThanCount = 0;
        let mustBeLessThanCount = 0;

        if (constraints.right && col + 1 < this.size) mustBeGreaterThanCount++;
        if (constraints.left && col - 1 >= 0) mustBeGreaterThanCount++;
        if (constraints.top && row - 1 >= 0) mustBeGreaterThanCount++;
        if (constraints.bottom && row + 1 < this.size) mustBeGreaterThanCount++;

        if (col + 1 < this.size && this.constraints[row][col + 1].left) mustBeLessThanCount++;
        if (col - 1 >= 0 && this.constraints[row][col - 1].right) mustBeLessThanCount++;
        if (row - 1 >= 0 && this.constraints[row - 1][col].bottom) mustBeLessThanCount++;
        if (row + 1 < this.size && this.constraints[row + 1][col].top) mustBeLessThanCount++;

        if (mustBeGreaterThanCount > 0) {
            for (let d = 1; d <= mustBeGreaterThanCount; d++) {
                possible.delete(d);
            }
        }

        if (mustBeLessThanCount > 0) {
            for (let d = this.size - mustBeLessThanCount + 1; d <= this.size; d++) {
                possible.delete(d);
            }
        }
    }

    updateSolvabilityDisplay(isSolvable, isComplete) {
        if (isComplete) {
            this.solvabilityStatus.textContent = 'Solved!';
            this.solvabilityStatus.className = 'solvability-status solved';
        } else if (isSolvable) {
            this.solvabilityStatus.textContent = 'Solvable';
            this.solvabilityStatus.className = 'solvability-status solvable';
        } else {
            this.solvabilityStatus.textContent = 'Not solvable';
            this.solvabilityStatus.className = 'solvability-status unsolvable';
        }
    }

    generatePuzzle() {
        this.size = parseInt(this.sizeSelect.value);
        this.initializeGrid();
        this.entryMode = false;
        this.givenCells = new Set();

        // Step 1: Generate a complete valid solution
        const solution = this.generateSolution();
        if (!solution) {
            alert('Failed to generate puzzle. Please try again.');
            return;
        }

        // Step 2: Add constraints based on the solution
        this.addConstraintsFromSolution(solution);

        // Step 3: Add some initial digits and ensure step-by-step solvability
        this.addInitialDigits(solution);

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
        this.updateConstraintIndicators();
        this.checkSolvability();
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
                        input.classList.add('has-value', 'given');
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

    addConstraintsFromSolution(solution) {
        // Add constraints between adjacent cells based on the solution
        // We'll add roughly 40-60% of possible constraints randomly
        const constraintProbability = 0.4 + Math.random() * 0.2;

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

    addInitialDigits(solution) {
        // Start with a few random given digits
        const totalCells = this.size * this.size;
        const initialGivens = Math.floor(this.size * 0.8); // Start with ~80% of size as givens

        // Add random initial givens
        const positions = [];
        for (let row = 0; row < this.size; row++) {
            for (let col = 0; col < this.size; col++) {
                positions.push({ row, col });
            }
        }
        this.shuffleArray(positions);

        for (let i = 0; i < initialGivens && i < positions.length; i++) {
            const { row, col } = positions[i];
            this.grid[row][col] = solution[row][col];
        }

        // Now ensure the puzzle is step-by-step solvable
        // Keep adding digits until every step has at least one cell with only one option
        this.ensureStepByStepSolvable(solution);
    }

    ensureStepByStepSolvable(solution) {
        const maxIterations = this.size * this.size;
        let iterations = 0;

        while (iterations < maxIterations) {
            iterations++;

            // Check if puzzle is complete
            const emptyCells = [];
            for (let row = 0; row < this.size; row++) {
                for (let col = 0; col < this.size; col++) {
                    if (this.grid[row][col] === null) {
                        emptyCells.push({ row, col });
                    }
                }
            }

            if (emptyCells.length === 0) {
                break; // Puzzle complete
            }

            // Find cells with only one possible digit
            let foundSolvableCell = false;
            for (const { row, col } of emptyCells) {
                const possible = this.getPossibleDigits(row, col);
                if (possible.size === 1) {
                    foundSolvableCell = true;
                    break;
                }
            }

            if (foundSolvableCell) {
                // Good - there's at least one solvable cell
                // Simulate solving one step to continue checking
                for (const { row, col } of emptyCells) {
                    const possible = this.getPossibleDigits(row, col);
                    if (possible.size === 1) {
                        // Don't actually fill it in for the puzzle - just verify solvability
                        break;
                    }
                }
                break; // Puzzle has at least one solvable cell, we're good
            } else {
                // No cell has only one option - need to add more givens
                // Find the cell with the fewest options and add it as a given
                let minOptions = this.size + 1;
                let bestCell = null;

                for (const { row, col } of emptyCells) {
                    const possible = this.getPossibleDigits(row, col);
                    if (possible.size > 0 && possible.size < minOptions) {
                        minOptions = possible.size;
                        bestCell = { row, col };
                    }
                }

                if (bestCell) {
                    this.grid[bestCell.row][bestCell.col] = solution[bestCell.row][bestCell.col];
                } else {
                    break; // Can't proceed
                }
            }
        }

        // Final verification: simulate solving the entire puzzle step by step
        this.verifyAndFixSolvability(solution);
    }

    verifyAndFixSolvability(solution) {
        // Create a working copy of the grid
        const workingGrid = this.grid.map(row => [...row]);
        const originalGrid = this.grid;
        this.grid = workingGrid;

        let iterations = 0;
        const maxIterations = this.size * this.size;

        while (iterations < maxIterations) {
            iterations++;

            // Find empty cells
            const emptyCells = [];
            for (let row = 0; row < this.size; row++) {
                for (let col = 0; col < this.size; col++) {
                    if (this.grid[row][col] === null) {
                        emptyCells.push({ row, col });
                    }
                }
            }

            if (emptyCells.length === 0) {
                break; // Solved
            }

            // Find a cell with exactly one possible digit
            let solved = false;
            for (const { row, col } of emptyCells) {
                const possible = this.getPossibleDigits(row, col);
                if (possible.size === 1) {
                    const digit = [...possible][0];
                    this.grid[row][col] = digit;
                    solved = true;
                    break;
                }
            }

            if (!solved) {
                // Need to add another given to the original grid
                // Find the cell with fewest options
                let minOptions = this.size + 1;
                let bestCell = null;

                for (const { row, col } of emptyCells) {
                    const possible = this.getPossibleDigits(row, col);
                    if (possible.size > 0 && possible.size < minOptions) {
                        minOptions = possible.size;
                        bestCell = { row, col };
                    }
                }

                if (bestCell) {
                    // Add this as a given in both grids
                    originalGrid[bestCell.row][bestCell.col] = solution[bestCell.row][bestCell.col];
                    this.grid[bestCell.row][bestCell.col] = solution[bestCell.row][bestCell.col];
                } else {
                    break;
                }
            }
        }

        // Restore the original grid (with any added givens)
        this.grid = originalGrid;
    }
}

// Initialize the game when the DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new FutoshikiGame();
});
