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

// Web Worker for puzzle generation
// This runs in a separate thread to keep the UI responsive

let size = 5;
let grid = [];
let constraints = [];
let cancelled = false;

// Message handler
onmessage = function(e) {
    const { type, data } = e.data;

    switch (type) {
        case 'generate':
            cancelled = false;
            size = data.size;
            generatePuzzle(data.difficulty);
            break;
        case 'cancel':
            cancelled = true;
            break;
    }
};

function initializeGrid() {
    grid = [];
    constraints = [];
    for (let row = 0; row < size; row++) {
        grid[row] = new Array(size).fill(null);
        constraints[row] = [];
        for (let col = 0; col < size; col++) {
            constraints[row][col] = { right: false, left: false, top: false, bottom: false };
        }
    }
}

function generatePuzzle(difficulty) {
    const startTime = Date.now();
    const maxTime = 30000; // 30 seconds timeout

    let bestPuzzle = null;
    let bestHintCount = Infinity;
    let attempts = 0;
    let successfulAttempts = 0;

    const countTotalHints = (g, c) => {
        let count = 0;
        for (let row = 0; row < size; row++) {
            for (let col = 0; col < size; col++) {
                if (g[row][col] !== null) count++;
                if (c[row][col].right) count++;
                if (c[row][col].bottom) count++;
            }
        }
        return count;
    };

    while ((Date.now() - startTime) < maxTime && !cancelled) {
        attempts++;

        // Send progress every 10 attempts
        if (attempts % 10 === 0) {
            const elapsed = (Date.now() - startTime) / 1000;
            postMessage({
                type: 'progress',
                attempts: successfulAttempts,
                bestHintCount: bestHintCount === Infinity ? null : bestHintCount,
                elapsed
            });
        }

        // Initialize fresh grid and constraints
        initializeGrid();

        // Step 1: Generate a complete valid solution
        const solution = generateSolution();
        if (!solution) continue;

        // Step 2: Add constraints based on the solution
        addConstraintsFromSolution(solution, difficulty);

        // Step 3: Generate puzzle with appropriate difficulty
        const success = generatePuzzleForDifficulty(solution, difficulty);
        if (!success) continue;

        successfulAttempts++;

        // Count total hints
        const hintCount = countTotalHints(grid, constraints);

        // Keep this puzzle if it has fewer total hints
        if (hintCount < bestHintCount) {
            bestHintCount = hintCount;
            bestPuzzle = {
                grid: grid.map(row => [...row]),
                constraints: constraints.map(row => row.map(c => ({ ...c })))
            };

            // Notify about new best
            postMessage({
                type: 'progress',
                attempts: successfulAttempts,
                bestHintCount,
                elapsed: (Date.now() - startTime) / 1000
            });
        }
    }

    if (cancelled) {
        // If cancelled but we have a best puzzle, send it (for "Use Best" functionality)
        if (bestPuzzle) {
            postMessage({
                type: 'complete',
                grid: bestPuzzle.grid,
                constraints: bestPuzzle.constraints,
                hintCount: bestHintCount
            });
        } else {
            postMessage({ type: 'cancelled' });
        }
        return;
    }

    if (!bestPuzzle) {
        postMessage({
            type: 'error',
            message: `Failed to generate ${difficulty} puzzle after ${attempts} attempts.`
        });
        return;
    }

    postMessage({
        type: 'complete',
        grid: bestPuzzle.grid,
        constraints: bestPuzzle.constraints,
        hintCount: bestHintCount
    });
}

// ========== Solution Generation ==========

function generateSolution() {
    const solution = [];
    for (let row = 0; row < size; row++) {
        solution[row] = new Array(size).fill(null);
    }

    if (fillSolutionGrid(solution, 0, 0)) {
        return solution;
    }
    return null;
}

function fillSolutionGrid(g, row, col) {
    if (row >= size) {
        return true;
    }

    const nextCol = (col + 1) % size;
    const nextRow = nextCol === 0 ? row + 1 : row;

    const available = getAvailableDigits(g, row, col);
    shuffleArray(available);

    for (const digit of available) {
        g[row][col] = digit;
        if (fillSolutionGrid(g, nextRow, nextCol)) {
            return true;
        }
        g[row][col] = null;
    }

    return false;
}

function getAvailableDigits(g, row, col) {
    const used = new Set();

    for (let c = 0; c < size; c++) {
        if (g[row][c] !== null) used.add(g[row][c]);
    }
    for (let r = 0; r < size; r++) {
        if (g[r][col] !== null) used.add(g[r][col]);
    }

    const available = [];
    for (let d = 1; d <= size; d++) {
        if (!used.has(d)) available.push(d);
    }
    return available;
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

// ========== Constraint Generation ==========

function addConstraintsFromSolution(solution, difficulty) {
    let constraintProbability;
    switch (difficulty) {
        case 'easy':
            constraintProbability = 0.6 + Math.random() * 0.2;
            break;
        case 'medium':
            constraintProbability = 0.4 + Math.random() * 0.2;
            break;
        case 'hard':
            constraintProbability = 0.25 + Math.random() * 0.15;
            break;
        default:
            constraintProbability = 0.5;
    }

    for (let row = 0; row < size; row++) {
        for (let col = 0; col < size; col++) {
            if (col + 1 < size && Math.random() < constraintProbability) {
                if (solution[row][col] > solution[row][col + 1]) {
                    constraints[row][col].right = true;
                } else {
                    constraints[row][col + 1].left = true;
                }
            }

            if (row + 1 < size && Math.random() < constraintProbability) {
                if (solution[row][col] > solution[row + 1][col]) {
                    constraints[row][col].bottom = true;
                } else {
                    constraints[row + 1][col].top = true;
                }
            }
        }
    }
}

// ========== Puzzle Generation ==========

function generatePuzzleForDifficulty(solution, difficulty) {
    // Start with all cells filled
    for (let row = 0; row < size; row++) {
        for (let col = 0; col < size; col++) {
            grid[row][col] = solution[row][col];
        }
    }

    // Get all positions and shuffle them
    const positions = [];
    for (let row = 0; row < size; row++) {
        for (let col = 0; col < size; col++) {
            positions.push({ row, col });
        }
    }
    shuffleArray(positions);

    // Try to remove each digit
    for (const { row, col } of positions) {
        const backup = grid[row][col];
        grid[row][col] = null;

        const analysis = analyzePuzzleDifficulty();

        if (!analysis.solvable) {
            grid[row][col] = backup;
        } else if (difficulty === 'easy' && analysis.maxStrategyRequired !== 'nakedSingle') {
            grid[row][col] = backup;
        } else if (difficulty === 'medium' && analysis.maxStrategyRequired === 'xWing') {
            grid[row][col] = backup;
        }
    }

    const finalAnalysis = analyzePuzzleDifficulty();

    if (difficulty === 'medium') {
        if (finalAnalysis.maxStrategyRequired === 'nakedSingle') {
            return false;
        }
    } else if (difficulty === 'hard') {
        if (finalAnalysis.maxStrategyRequired !== 'xWing') {
            return false;
        }
    }

    return finalAnalysis.solvable;
}

// ========== Difficulty Analysis ==========

function analyzePuzzleDifficulty() {
    const originalGrid = grid;
    const workingGrid = originalGrid.map(row => [...row]);
    grid = workingGrid;

    let maxStrategy = 'nakedSingle';
    let solved = false;
    let maxSteps = size * size * 2;

    while (maxSteps > 0) {
        maxSteps--;

        let emptyCells = 0;
        for (let row = 0; row < size; row++) {
            for (let col = 0; col < size; col++) {
                if (grid[row][col] === null) emptyCells++;
            }
        }

        if (emptyCells === 0) {
            solved = true;
            break;
        }

        // Try naked singles
        let madeProgress = false;
        for (let row = 0; row < size; row++) {
            for (let col = 0; col < size; col++) {
                if (grid[row][col] === null) {
                    const possible = getPossibleDigits(row, col);
                    if (possible.size === 0) {
                        grid = originalGrid;
                        return { solvable: false, maxStrategyRequired: maxStrategy };
                    }
                    if (possible.size === 1) {
                        grid[row][col] = [...possible][0];
                        madeProgress = true;
                    }
                }
            }
        }
        if (madeProgress) continue;

        // Try hidden singles
        const hiddenSingle = findHiddenSingle();
        if (hiddenSingle) {
            grid[hiddenSingle.row][hiddenSingle.col] = hiddenSingle.digit;
            if (maxStrategy === 'nakedSingle') maxStrategy = 'hiddenSingle';
            continue;
        }

        // Try naked pairs
        const nakedPair = findNakedPairs();
        if (nakedPair) {
            if (maxStrategy === 'nakedSingle' || maxStrategy === 'hiddenSingle') {
                maxStrategy = 'nakedPair';
            }
            continue;
        }

        // Try hidden pairs
        const hiddenPair = findHiddenPairs();
        if (hiddenPair) {
            if (maxStrategy === 'nakedSingle' || maxStrategy === 'hiddenSingle' || maxStrategy === 'nakedPair') {
                maxStrategy = 'hiddenPair';
            }
            continue;
        }

        // Try X-Wing
        const xWing = findXWing();
        if (xWing) {
            maxStrategy = 'xWing';
            continue;
        }

        // No strategy worked
        grid = originalGrid;
        return { solvable: false, maxStrategyRequired: maxStrategy };
    }

    grid = originalGrid;
    return { solvable: solved, maxStrategyRequired: maxStrategy };
}

// ========== Constraint Propagation ==========

function getPossibleDigits(row, col) {
    const allPossible = computeAllPossibleDigits();
    return allPossible[row][col];
}

function computeAllPossibleDigits() {
    const possible = [];
    for (let row = 0; row < size; row++) {
        possible[row] = [];
        for (let col = 0; col < size; col++) {
            if (grid[row][col] !== null) {
                possible[row][col] = new Set([grid[row][col]]);
            } else {
                possible[row][col] = new Set();
                for (let d = 1; d <= size; d++) {
                    possible[row][col].add(d);
                }
                for (let c = 0; c < size; c++) {
                    if (grid[row][c] !== null) {
                        possible[row][col].delete(grid[row][c]);
                    }
                }
                for (let r = 0; r < size; r++) {
                    if (grid[r][col] !== null) {
                        possible[row][col].delete(grid[r][col]);
                    }
                }
            }
        }
    }

    let changed = true;
    while (changed) {
        changed = false;
        for (let row = 0; row < size; row++) {
            for (let col = 0; col < size; col++) {
                if (applyConstraintsPropagation(row, col, possible)) {
                    changed = true;
                }
            }
        }
    }

    return possible;
}

function applyConstraintsPropagation(row, col, allPossible) {
    const myPossible = allPossible[row][col];
    if (myPossible.size === 0) return false;

    const sizeBefore = myPossible.size;
    const cons = constraints[row][col];

    // For each direction where this cell > neighbor
    const greaterThan = [
        { hasConstraint: cons.right, nRow: row, nCol: col + 1 },
        { hasConstraint: cons.left, nRow: row, nCol: col - 1 },
        { hasConstraint: cons.top, nRow: row - 1, nCol: col },
        { hasConstraint: cons.bottom, nRow: row + 1, nCol: col }
    ];

    for (const { hasConstraint, nRow, nCol } of greaterThan) {
        if (hasConstraint && nRow >= 0 && nRow < size && nCol >= 0 && nCol < size) {
            const neighborPossible = allPossible[nRow][nCol];
            if (neighborPossible.size === 0 || myPossible.size === 0) continue;

            const neighborMin = Math.min(...neighborPossible);
            const myMax = Math.max(...myPossible);

            for (let d = 1; d <= neighborMin; d++) {
                myPossible.delete(d);
            }
            for (let d = myMax; d <= size; d++) {
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
        if (nRow >= 0 && nRow < size && nCol >= 0 && nCol < size) {
            if (constraints[nRow][nCol][prop]) {
                const neighborPossible = allPossible[nRow][nCol];
                if (neighborPossible.size === 0 || myPossible.size === 0) continue;

                const neighborMax = Math.max(...neighborPossible);
                for (let d = neighborMax; d <= size; d++) {
                    myPossible.delete(d);
                }
            }
        }
    }

    applyMultiConstraintPropagation(row, col, allPossible);

    return myPossible.size !== sizeBefore;
}

function applyMultiConstraintPropagation(row, col, allPossible) {
    const myPossible = allPossible[row][col];
    if (myPossible.size === 0) return;

    const cons = constraints[row][col];

    // Row neighbors where neighbor > this cell
    const rowNeighborsGreater = [];
    if (col > 0 && constraints[row][col - 1].right) {
        rowNeighborsGreater.push({ nRow: row, nCol: col - 1 });
    }
    if (col < size - 1 && constraints[row][col + 1].left) {
        rowNeighborsGreater.push({ nRow: row, nCol: col + 1 });
    }

    // Column neighbors where neighbor > this cell
    const colNeighborsGreater = [];
    if (row > 0 && constraints[row - 1][col].bottom) {
        colNeighborsGreater.push({ nRow: row - 1, nCol: col });
    }
    if (row < size - 1 && constraints[row + 1][col].top) {
        colNeighborsGreater.push({ nRow: row + 1, nCol: col });
    }

    // Row neighbors where this cell > neighbor
    const rowNeighborsSmaller = [];
    if (cons.left && col > 0) {
        rowNeighborsSmaller.push({ nRow: row, nCol: col - 1 });
    }
    if (cons.right && col < size - 1) {
        rowNeighborsSmaller.push({ nRow: row, nCol: col + 1 });
    }

    // Column neighbors where this cell > neighbor
    const colNeighborsSmaller = [];
    if (cons.top && row > 0) {
        colNeighborsSmaller.push({ nRow: row - 1, nCol: col });
    }
    if (cons.bottom && row < size - 1) {
        colNeighborsSmaller.push({ nRow: row + 1, nCol: col });
    }

    // Apply stricter bounds for multiple constraints
    if (rowNeighborsGreater.length >= 2) {
        const maxValues = rowNeighborsGreater.map(n => {
            const np = allPossible[n.nRow][n.nCol];
            return np.size > 0 ? Math.max(...np) : size;
        });
        maxValues.sort((a, b) => a - b);
        const strictMax = maxValues[rowNeighborsGreater.length - 1] - rowNeighborsGreater.length;
        for (let d = strictMax + 1; d <= size; d++) {
            myPossible.delete(d);
        }
    }

    if (colNeighborsGreater.length >= 2) {
        const maxValues = colNeighborsGreater.map(n => {
            const np = allPossible[n.nRow][n.nCol];
            return np.size > 0 ? Math.max(...np) : size;
        });
        maxValues.sort((a, b) => a - b);
        const strictMax = maxValues[colNeighborsGreater.length - 1] - colNeighborsGreater.length;
        for (let d = strictMax + 1; d <= size; d++) {
            myPossible.delete(d);
        }
    }

    if (rowNeighborsSmaller.length >= 2) {
        const minValues = rowNeighborsSmaller.map(n => {
            const np = allPossible[n.nRow][n.nCol];
            return np.size > 0 ? Math.min(...np) : 1;
        });
        minValues.sort((a, b) => b - a);
        const strictMin = minValues[rowNeighborsSmaller.length - 1] + rowNeighborsSmaller.length;
        for (let d = 1; d < strictMin; d++) {
            myPossible.delete(d);
        }
    }

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

// ========== Strategy Functions ==========

function findHiddenSingle() {
    // Check rows
    for (let row = 0; row < size; row++) {
        for (let digit = 1; digit <= size; digit++) {
            let alreadyPlaced = false;
            for (let col = 0; col < size; col++) {
                if (grid[row][col] === digit) {
                    alreadyPlaced = true;
                    break;
                }
            }
            if (alreadyPlaced) continue;

            const possibleCols = [];
            for (let col = 0; col < size; col++) {
                if (grid[row][col] === null) {
                    const possible = getPossibleDigits(row, col);
                    if (possible.has(digit)) {
                        possibleCols.push(col);
                    }
                }
            }

            if (possibleCols.length === 1) {
                return { row, col: possibleCols[0], digit };
            }
        }
    }

    // Check columns
    for (let col = 0; col < size; col++) {
        for (let digit = 1; digit <= size; digit++) {
            let alreadyPlaced = false;
            for (let row = 0; row < size; row++) {
                if (grid[row][col] === digit) {
                    alreadyPlaced = true;
                    break;
                }
            }
            if (alreadyPlaced) continue;

            const possibleRows = [];
            for (let row = 0; row < size; row++) {
                if (grid[row][col] === null) {
                    const possible = getPossibleDigits(row, col);
                    if (possible.has(digit)) {
                        possibleRows.push(row);
                    }
                }
            }

            if (possibleRows.length === 1) {
                return { row: possibleRows[0], col, digit };
            }
        }
    }

    return null;
}

function getAllPencilMarks() {
    const pencilMarks = new Map();
    for (let row = 0; row < size; row++) {
        for (let col = 0; col < size; col++) {
            if (grid[row][col] === null) {
                pencilMarks.set(`${row},${col}`, getPossibleDigits(row, col));
            }
        }
    }
    return pencilMarks;
}

function findNakedPairs() {
    const pencilMarks = getAllPencilMarks();

    for (let row = 0; row < size; row++) {
        const result = findNakedPairsInLine(pencilMarks, row, 'row');
        if (result) return result;
    }

    for (let col = 0; col < size; col++) {
        const result = findNakedPairsInLine(pencilMarks, col, 'col');
        if (result) return result;
    }

    return null;
}

function findNakedPairsInLine(pencilMarks, index, type) {
    const pairCells = [];

    for (let i = 0; i < size; i++) {
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

    for (let i = 0; i < pairCells.length; i++) {
        for (let j = i + 1; j < pairCells.length; j++) {
            if (pairCells[i].marks === pairCells[j].marks) {
                const pairDigits = pairCells[i].marks.split(',').map(Number);
                const pairPositions = new Set([
                    `${pairCells[i].row},${pairCells[i].col}`,
                    `${pairCells[j].row},${pairCells[j].col}`
                ]);

                for (let k = 0; k < size; k++) {
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
                            return { type: 'nakedPair', pairDigits, eliminated };
                        }
                    }
                }
            }
        }
    }

    return null;
}

function findHiddenPairs() {
    const pencilMarks = getAllPencilMarks();

    for (let row = 0; row < size; row++) {
        const result = findHiddenPairsInLine(pencilMarks, row, 'row');
        if (result) return result;
    }

    for (let col = 0; col < size; col++) {
        const result = findHiddenPairsInLine(pencilMarks, col, 'col');
        if (result) return result;
    }

    return null;
}

function findHiddenPairsInLine(pencilMarks, index, type) {
    const digitToCells = new Map();

    for (let d = 1; d <= size; d++) {
        digitToCells.set(d, []);
    }

    for (let i = 0; i < size; i++) {
        const row = type === 'row' ? index : i;
        const col = type === 'row' ? i : index;
        const key = `${row},${col}`;

        if (grid[row][col] !== null) {
            digitToCells.delete(grid[row][col]);
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

    const digits = [...digitToCells.keys()];

    for (let i = 0; i < digits.length; i++) {
        for (let j = i + 1; j < digits.length; j++) {
            const d1 = digits[i];
            const d2 = digits[j];
            const cells1 = digitToCells.get(d1);
            const cells2 = digitToCells.get(d2);

            if (cells1.length === 2 && cells2.length === 2) {
                const key1a = `${cells1[0].row},${cells1[0].col}`;
                const key1b = `${cells1[1].row},${cells1[1].col}`;
                const key2a = `${cells2[0].row},${cells2[0].col}`;
                const key2b = `${cells2[1].row},${cells2[1].col}`;

                if ((key1a === key2a && key1b === key2b) || (key1a === key2b && key1b === key2a)) {
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
                                return { type: 'hiddenPair', pairDigits: [d1, d2], eliminated };
                            }
                        }
                    }
                }
            }
        }
    }

    return null;
}

function findXWing() {
    const pencilMarks = getAllPencilMarks();

    for (let digit = 1; digit <= size; digit++) {
        const result = findXWingForDigit(pencilMarks, digit, 'row');
        if (result) return result;

        const result2 = findXWingForDigit(pencilMarks, digit, 'col');
        if (result2) return result2;
    }

    return null;
}

function findXWingForDigit(pencilMarks, digit, type) {
    const linesWithTwoCells = [];

    for (let i = 0; i < size; i++) {
        const cellsWithDigit = [];

        for (let j = 0; j < size; j++) {
            const row = type === 'row' ? i : j;
            const col = type === 'row' ? j : i;

            if (grid[row][col] !== null) continue;

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

    for (let i = 0; i < linesWithTwoCells.length; i++) {
        for (let j = i + 1; j < linesWithTwoCells.length; j++) {
            if (linesWithTwoCells[i].positions === linesWithTwoCells[j].positions) {
                const pos1 = linesWithTwoCells[i].cells[0].pos;
                const pos2 = linesWithTwoCells[i].cells[1].pos;

                const xWingCells = new Set([
                    ...linesWithTwoCells[i].cells.map(c => `${c.row},${c.col}`),
                    ...linesWithTwoCells[j].cells.map(c => `${c.row},${c.col}`)
                ]);

                for (const crossPos of [pos1, pos2]) {
                    for (let k = 0; k < size; k++) {
                        const row = type === 'row' ? k : crossPos;
                        const col = type === 'row' ? crossPos : k;
                        const key = `${row},${col}`;

                        if (!xWingCells.has(key) && pencilMarks.has(key)) {
                            const marks = pencilMarks.get(key);
                            if (marks.has(digit)) {
                                return { type: 'xWing', digit, eliminated: new Set([digit]) };
                            }
                        }
                    }
                }
            }
        }
    }

    return null;
}
