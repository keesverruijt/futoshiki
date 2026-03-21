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
                // Count given digits
                if (g[row][col] !== null) count++;
                // Count all constraints (each constraint is stored on one cell only)
                if (c[row][col].right) count++;
                if (c[row][col].left) count++;
                if (c[row][col].bottom) count++;
                if (c[row][col].top) count++;
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

        // Step 1: Generate a complete valid solution (Latin square)
        const solution = generateSolution();
        if (!solution) continue;

        // Step 2: Generate puzzle (starts with all constraints, then removes digits/constraints)
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

            // Notify about new best (include puzzle data for "Use Best" functionality)
            postMessage({
                type: 'progress',
                attempts: successfulAttempts,
                bestHintCount,
                elapsed: (Date.now() - startTime) / 1000,
                bestGrid: bestPuzzle.grid,
                bestConstraints: bestPuzzle.constraints
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

// Add ALL constraints from the solution
function addAllConstraints(solution) {
    for (let row = 0; row < size; row++) {
        for (let col = 0; col < size; col++) {
            // Horizontal constraint (right neighbor)
            if (col + 1 < size) {
                if (solution[row][col] > solution[row][col + 1]) {
                    constraints[row][col].right = true;
                } else {
                    constraints[row][col + 1].left = true;
                }
            }

            // Vertical constraint (bottom neighbor)
            if (row + 1 < size) {
                if (solution[row][col] > solution[row + 1][col]) {
                    constraints[row][col].bottom = true;
                } else {
                    constraints[row + 1][col].top = true;
                }
            }
        }
    }
}

// Get list of all active constraints
function getActiveConstraints() {
    const active = [];
    for (let row = 0; row < size; row++) {
        for (let col = 0; col < size; col++) {
            if (constraints[row][col].right) {
                active.push({ row, col, dir: 'right' });
            }
            if (constraints[row][col].left) {
                active.push({ row, col, dir: 'left' });
            }
            if (constraints[row][col].bottom) {
                active.push({ row, col, dir: 'bottom' });
            }
            if (constraints[row][col].top) {
                active.push({ row, col, dir: 'top' });
            }
        }
    }
    return active;
}

// ========== Puzzle Generation ==========

function generatePuzzleForDifficulty(solution, difficulty) {
    // Start with all cells filled
    for (let row = 0; row < size; row++) {
        for (let col = 0; col < size; col++) {
            grid[row][col] = solution[row][col];
        }
    }

    // Add ALL constraints
    addAllConstraints(solution);

    // Get all digit positions and shuffle them
    const digitPositions = [];
    for (let row = 0; row < size; row++) {
        for (let col = 0; col < size; col++) {
            digitPositions.push({ row, col });
        }
    }
    shuffleArray(digitPositions);

    // Track what we can still remove
    let canRemoveDigits = true;
    let canRemoveConstraints = true;
    let digitIndex = 0;

    // Alternate between removing digits and constraints until neither is possible
    while ((canRemoveDigits || canRemoveConstraints) && !cancelled) {
        // Try to remove a digit
        if (canRemoveDigits) {
            let removedDigit = false;

            while (digitIndex < digitPositions.length) {
                const { row, col } = digitPositions[digitIndex];
                digitIndex++;

                if (grid[row][col] === null) continue;

                const backup = grid[row][col];
                grid[row][col] = null;

                const analysis = analyzePuzzleDifficulty();

                let keep = analysis.solvable;
                if (keep && difficulty === 'easy' && analysis.maxStrategyRequired !== 'nakedSingle') {
                    keep = false;
                }
                if (keep && difficulty === 'medium' && analysis.maxStrategyRequired === 'xWing') {
                    keep = false;
                }

                if (keep) {
                    removedDigit = true;
                    break;
                } else {
                    grid[row][col] = backup;
                }
            }

            if (!removedDigit) {
                canRemoveDigits = false;
            }
        }

        // Try to remove a constraint
        if (canRemoveConstraints) {
            const activeConstraints = getActiveConstraints();
            shuffleArray(activeConstraints);

            let removedConstraint = false;

            for (const c of activeConstraints) {
                constraints[c.row][c.col][c.dir] = false;

                const analysis = analyzePuzzleDifficulty();

                let keep = analysis.solvable;
                if (keep && difficulty === 'easy' && analysis.maxStrategyRequired !== 'nakedSingle') {
                    keep = false;
                }
                if (keep && difficulty === 'medium' && analysis.maxStrategyRequired === 'xWing') {
                    keep = false;
                }

                if (keep) {
                    removedConstraint = true;
                    break;
                } else {
                    constraints[c.row][c.col][c.dir] = true;
                }
            }

            if (!removedConstraint) {
                canRemoveConstraints = false;
            }
        }
    }

    const finalAnalysis = analyzePuzzleDifficulty();

    if (!finalAnalysis.solvable) {
        return false;
    }

    // Check difficulty requirements
    // Strategy hierarchy: nakedSingle < hiddenSingle < nakedPair < hiddenPair < nakedTriplet < hiddenTriplet < nakedQuadruplet < hiddenQuadruplet < xWing
    const strategyLevel = {
        'nakedSingle': 1,
        'hiddenSingle': 2,
        'nakedPair': 3,
        'hiddenPair': 4,
        'nakedTriplet': 5,
        'hiddenTriplet': 6,
        'nakedQuadruplet': 7,
        'hiddenQuadruplet': 8,
        'xWing': 9
    };
    const level = strategyLevel[finalAnalysis.maxStrategyRequired] || 0;

    if (difficulty === 'easy') {
        // Easy: only naked singles
        if (level > 1) return false;
    } else if (difficulty === 'medium') {
        // Medium: requires at least hidden singles, but not advanced strategies
        if (level < 2 || level > 4) return false;
    } else if (difficulty === 'hard') {
        // Hard: requires at least hidden pairs or more advanced strategies
        if (level < 4) return false;
    }

    // Verify the puzzle has exactly one solution
    if (!hasUniqueSolution()) {
        return false;
    }

    return true;
}

// ========== Uniqueness Check ==========

// Count solutions using backtracking (stops at 2)
function hasUniqueSolution() {
    const workingGrid = grid.map(row => [...row]);
    let solutionCount = 0;

    function solve(g) {
        if (solutionCount >= 2) return; // Early exit if multiple solutions found

        // Find first empty cell
        let emptyRow = -1, emptyCol = -1;
        outer: for (let row = 0; row < size; row++) {
            for (let col = 0; col < size; col++) {
                if (g[row][col] === null) {
                    emptyRow = row;
                    emptyCol = col;
                    break outer;
                }
            }
        }

        // No empty cells - found a solution
        if (emptyRow === -1) {
            solutionCount++;
            return;
        }

        // Try each digit
        for (let digit = 1; digit <= size; digit++) {
            if (isValidPlacement(g, emptyRow, emptyCol, digit)) {
                g[emptyRow][emptyCol] = digit;
                solve(g);
                g[emptyRow][emptyCol] = null;

                if (solutionCount >= 2) return; // Early exit
            }
        }
    }

    function isValidPlacement(g, row, col, digit) {
        // Check row
        for (let c = 0; c < size; c++) {
            if (g[row][c] === digit) return false;
        }

        // Check column
        for (let r = 0; r < size; r++) {
            if (g[r][col] === digit) return false;
        }

        // Check constraints
        const cons = constraints[row][col];

        // This cell > right neighbor
        if (cons.right && col + 1 < size) {
            const neighbor = g[row][col + 1];
            if (neighbor !== null && digit <= neighbor) return false;
        }

        // This cell > left neighbor
        if (cons.left && col > 0) {
            const neighbor = g[row][col - 1];
            if (neighbor !== null && digit <= neighbor) return false;
        }

        // This cell > bottom neighbor
        if (cons.bottom && row + 1 < size) {
            const neighbor = g[row + 1][col];
            if (neighbor !== null && digit <= neighbor) return false;
        }

        // This cell > top neighbor
        if (cons.top && row > 0) {
            const neighbor = g[row - 1][col];
            if (neighbor !== null && digit <= neighbor) return false;
        }

        // Check if neighbors have constraints pointing to this cell
        // Right neighbor > this cell
        if (col + 1 < size && constraints[row][col + 1].left) {
            const neighbor = g[row][col + 1];
            if (neighbor !== null && digit >= neighbor) return false;
        }

        // Left neighbor > this cell
        if (col > 0 && constraints[row][col - 1].right) {
            const neighbor = g[row][col - 1];
            if (neighbor !== null && digit >= neighbor) return false;
        }

        // Bottom neighbor > this cell
        if (row + 1 < size && constraints[row + 1][col].top) {
            const neighbor = g[row + 1][col];
            if (neighbor !== null && digit >= neighbor) return false;
        }

        // Top neighbor > this cell
        if (row > 0 && constraints[row - 1][col].bottom) {
            const neighbor = g[row - 1][col];
            if (neighbor !== null && digit >= neighbor) return false;
        }

        return true;
    }

    solve(workingGrid);
    return solutionCount === 1;
}

// ========== Difficulty Analysis ==========

// Persistent eliminated candidates for the solver
let eliminatedCandidates = null;

function initEliminatedCandidates() {
    eliminatedCandidates = new Map();
}

function isEliminated(row, col, digit) {
    const key = `${row},${col}`;
    return eliminatedCandidates.has(key) && eliminatedCandidates.get(key).has(digit);
}

function eliminateCandidate(row, col, digit) {
    const key = `${row},${col}`;
    if (!eliminatedCandidates.has(key)) {
        eliminatedCandidates.set(key, new Set());
    }
    eliminatedCandidates.get(key).add(digit);
}

function getPossibleDigitsWithEliminations(row, col) {
    const base = getPossibleDigits(row, col);
    const result = new Set();
    for (const digit of base) {
        if (!isEliminated(row, col, digit)) {
            result.add(digit);
        }
    }
    return result;
}

function getAllPencilMarksWithEliminations() {
    const pencilMarks = new Map();
    for (let row = 0; row < size; row++) {
        for (let col = 0; col < size; col++) {
            if (grid[row][col] === null) {
                pencilMarks.set(`${row},${col}`, getPossibleDigitsWithEliminations(row, col));
            }
        }
    }
    return pencilMarks;
}

function analyzePuzzleDifficulty() {
    const originalGrid = grid;
    const workingGrid = originalGrid.map(row => [...row]);
    grid = workingGrid;
    initEliminatedCandidates();

    let maxStrategy = 'nakedSingle';
    let solved = false;
    let maxSteps = size * size * 10; // Increased for more complex strategies

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

        // Try naked singles (including those created by eliminations)
        let madeProgress = false;
        for (let row = 0; row < size; row++) {
            for (let col = 0; col < size; col++) {
                if (grid[row][col] === null) {
                    const possible = getPossibleDigitsWithEliminations(row, col);
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
        const hiddenSingle = findHiddenSingleWithEliminations();
        if (hiddenSingle) {
            grid[hiddenSingle.row][hiddenSingle.col] = hiddenSingle.digit;
            if (maxStrategy === 'nakedSingle') maxStrategy = 'hiddenSingle';
            continue;
        }

        // Try naked pairs
        const nakedPair = findNakedPairsWithEliminations();
        if (nakedPair) {
            // Apply the eliminations
            for (const digit of nakedPair.eliminated) {
                eliminateCandidate(nakedPair.affectedCell.row, nakedPair.affectedCell.col, digit);
            }
            if (maxStrategy === 'nakedSingle' || maxStrategy === 'hiddenSingle') {
                maxStrategy = 'nakedPair';
            }
            continue;
        }

        // Try hidden pairs
        const hiddenPair = findHiddenPairsWithEliminations();
        if (hiddenPair) {
            // Apply the eliminations
            for (const digit of hiddenPair.eliminated) {
                eliminateCandidate(hiddenPair.affectedCell.row, hiddenPair.affectedCell.col, digit);
            }
            if (maxStrategy === 'nakedSingle' || maxStrategy === 'hiddenSingle' || maxStrategy === 'nakedPair') {
                maxStrategy = 'hiddenPair';
            }
            continue;
        }

        // Try naked triplets
        const nakedTriplet = findNakedTripletsWithEliminations();
        if (nakedTriplet) {
            for (const digit of nakedTriplet.eliminated) {
                eliminateCandidate(nakedTriplet.affectedCell.row, nakedTriplet.affectedCell.col, digit);
            }
            if (['nakedSingle', 'hiddenSingle', 'nakedPair', 'hiddenPair'].includes(maxStrategy)) {
                maxStrategy = 'nakedTriplet';
            }
            continue;
        }

        // Try hidden triplets
        const hiddenTriplet = findHiddenTripletsWithEliminations();
        if (hiddenTriplet) {
            for (const digit of hiddenTriplet.eliminated) {
                eliminateCandidate(hiddenTriplet.affectedCell.row, hiddenTriplet.affectedCell.col, digit);
            }
            if (['nakedSingle', 'hiddenSingle', 'nakedPair', 'hiddenPair', 'nakedTriplet'].includes(maxStrategy)) {
                maxStrategy = 'hiddenTriplet';
            }
            continue;
        }

        // Try naked quadruplets (7x7 and larger)
        const nakedQuadruplet = findNakedQuadrupletsWithEliminations();
        if (nakedQuadruplet) {
            for (const digit of nakedQuadruplet.eliminated) {
                eliminateCandidate(nakedQuadruplet.affectedCell.row, nakedQuadruplet.affectedCell.col, digit);
            }
            if (['nakedSingle', 'hiddenSingle', 'nakedPair', 'hiddenPair', 'nakedTriplet', 'hiddenTriplet'].includes(maxStrategy)) {
                maxStrategy = 'nakedQuadruplet';
            }
            continue;
        }

        // Try hidden quadruplets (7x7 and larger)
        const hiddenQuadruplet = findHiddenQuadrupletsWithEliminations();
        if (hiddenQuadruplet) {
            for (const digit of hiddenQuadruplet.eliminated) {
                eliminateCandidate(hiddenQuadruplet.affectedCell.row, hiddenQuadruplet.affectedCell.col, digit);
            }
            if (maxStrategy !== 'xWing') {
                maxStrategy = 'hiddenQuadruplet';
            }
            continue;
        }

        // Try X-Wing
        const xWing = findXWingWithEliminations();
        if (xWing) {
            for (const cell of xWing.eliminatedCells) {
                eliminateCandidate(cell.row, cell.col, xWing.digit);
            }
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

// Hidden single that respects eliminations
function findHiddenSingleWithEliminations() {
    const pencilMarks = getAllPencilMarksWithEliminations();

    // Check rows
    for (let row = 0; row < size; row++) {
        for (let digit = 1; digit <= size; digit++) {
            const positions = [];
            for (let col = 0; col < size; col++) {
                if (grid[row][col] === digit) {
                    positions.length = 0;
                    break;
                }
                const key = `${row},${col}`;
                if (pencilMarks.has(key) && pencilMarks.get(key).has(digit)) {
                    positions.push({ row, col });
                }
            }
            if (positions.length === 1) {
                return { row: positions[0].row, col: positions[0].col, digit };
            }
        }
    }

    // Check columns
    for (let col = 0; col < size; col++) {
        for (let digit = 1; digit <= size; digit++) {
            const positions = [];
            for (let row = 0; row < size; row++) {
                if (grid[row][col] === digit) {
                    positions.length = 0;
                    break;
                }
                const key = `${row},${col}`;
                if (pencilMarks.has(key) && pencilMarks.get(key).has(digit)) {
                    positions.push({ row, col });
                }
            }
            if (positions.length === 1) {
                return { row: positions[0].row, col: positions[0].col, digit };
            }
        }
    }

    return null;
}

// Strategy functions that use eliminations
function findNakedPairsWithEliminations() {
    const pencilMarks = getAllPencilMarksWithEliminations();
    for (let row = 0; row < size; row++) {
        const result = findNakedPairsInLineWithEliminations(pencilMarks, row, 'row');
        if (result) return result;
    }
    for (let col = 0; col < size; col++) {
        const result = findNakedPairsInLineWithEliminations(pencilMarks, col, 'col');
        if (result) return result;
    }
    return null;
}

function findNakedPairsInLineWithEliminations(pencilMarks, index, type) {
    const pairCells = [];
    for (let i = 0; i < size; i++) {
        const row = type === 'row' ? index : i;
        const col = type === 'row' ? i : index;
        const key = `${row},${col}`;
        if (pencilMarks.has(key)) {
            const marks = pencilMarks.get(key);
            if (marks.size === 2) {
                pairCells.push({ row, col, marks: [...marks].sort().join(','), markSet: marks });
            }
        }
    }

    for (let i = 0; i < pairCells.length; i++) {
        for (let j = i + 1; j < pairCells.length; j++) {
            if (pairCells[i].marks === pairCells[j].marks) {
                const pairDigits = [...pairCells[i].markSet];
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
                            return { type: 'nakedPair', pairDigits, eliminated, affectedCell: { row, col } };
                        }
                    }
                }
            }
        }
    }
    return null;
}

function findHiddenPairsWithEliminations() {
    const pencilMarks = getAllPencilMarksWithEliminations();
    for (let row = 0; row < size; row++) {
        const result = findHiddenPairsInLineWithEliminations(pencilMarks, row, 'row');
        if (result) return result;
    }
    for (let col = 0; col < size; col++) {
        const result = findHiddenPairsInLineWithEliminations(pencilMarks, col, 'col');
        if (result) return result;
    }
    return null;
}

function findHiddenPairsInLineWithEliminations(pencilMarks, index, type) {
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
                                return { type: 'hiddenPair', pairDigits: [d1, d2], eliminated, affectedCell: cell };
                            }
                        }
                    }
                }
            }
        }
    }
    return null;
}

function findNakedTripletsWithEliminations() {
    const pencilMarks = getAllPencilMarksWithEliminations();
    for (let row = 0; row < size; row++) {
        const result = findNakedTripletsInLineWithEliminations(pencilMarks, row, 'row');
        if (result) return result;
    }
    for (let col = 0; col < size; col++) {
        const result = findNakedTripletsInLineWithEliminations(pencilMarks, col, 'col');
        if (result) return result;
    }
    return null;
}

function findNakedTripletsInLineWithEliminations(pencilMarks, index, type) {
    const candidateCells = [];
    for (let i = 0; i < size; i++) {
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

    for (let i = 0; i < candidateCells.length; i++) {
        for (let j = i + 1; j < candidateCells.length; j++) {
            for (let k = j + 1; k < candidateCells.length; k++) {
                const combined = new Set([
                    ...candidateCells[i].marks,
                    ...candidateCells[j].marks,
                    ...candidateCells[k].marks
                ]);

                if (combined.size === 3) {
                    const tripletDigits = [...combined];
                    const tripletPositions = new Set([
                        `${candidateCells[i].row},${candidateCells[i].col}`,
                        `${candidateCells[j].row},${candidateCells[j].col}`,
                        `${candidateCells[k].row},${candidateCells[k].col}`
                    ]);

                    for (let m = 0; m < size; m++) {
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
                                return { type: 'nakedTriplet', tripletDigits, eliminated, affectedCell: { row, col } };
                            }
                        }
                    }
                }
            }
        }
    }
    return null;
}

function findHiddenTripletsWithEliminations() {
    const pencilMarks = getAllPencilMarksWithEliminations();
    for (let row = 0; row < size; row++) {
        const result = findHiddenTripletsInLineWithEliminations(pencilMarks, row, 'row');
        if (result) return result;
    }
    for (let col = 0; col < size; col++) {
        const result = findHiddenTripletsInLineWithEliminations(pencilMarks, col, 'col');
        if (result) return result;
    }
    return null;
}

function findHiddenTripletsInLineWithEliminations(pencilMarks, index, type) {
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

                if (cellSet.size === 3) {
                    const tripletDigits = new Set([d1, d2, d3]);
                    const tripletCells = [...cellSet].map(key => {
                        const [row, col] = key.split(',').map(Number);
                        return { row, col };
                    });

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
                                return { type: 'hiddenTriplet', tripletDigits: [d1, d2, d3], eliminated, affectedCell: cell };
                            }
                        }
                    }
                }
            }
        }
    }
    return null;
}

function findNakedQuadrupletsWithEliminations() {
    if (size < 7) return null;
    const pencilMarks = getAllPencilMarksWithEliminations();
    for (let row = 0; row < size; row++) {
        const result = findNakedQuadrupletsInLineWithEliminations(pencilMarks, row, 'row');
        if (result) return result;
    }
    for (let col = 0; col < size; col++) {
        const result = findNakedQuadrupletsInLineWithEliminations(pencilMarks, col, 'col');
        if (result) return result;
    }
    return null;
}

function findNakedQuadrupletsInLineWithEliminations(pencilMarks, index, type) {
    const candidateCells = [];
    for (let i = 0; i < size; i++) {
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
                        const quadDigits = [...combined];
                        const quadPositions = new Set([
                            `${candidateCells[i].row},${candidateCells[i].col}`,
                            `${candidateCells[j].row},${candidateCells[j].col}`,
                            `${candidateCells[k].row},${candidateCells[k].col}`,
                            `${candidateCells[l].row},${candidateCells[l].col}`
                        ]);

                        for (let m = 0; m < size; m++) {
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
                                    return { type: 'nakedQuadruplet', quadDigits, eliminated, affectedCell: { row, col } };
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

function findHiddenQuadrupletsWithEliminations() {
    if (size < 7) return null;
    const pencilMarks = getAllPencilMarksWithEliminations();
    for (let row = 0; row < size; row++) {
        const result = findHiddenQuadrupletsInLineWithEliminations(pencilMarks, row, 'row');
        if (result) return result;
    }
    for (let col = 0; col < size; col++) {
        const result = findHiddenQuadrupletsInLineWithEliminations(pencilMarks, col, 'col');
        if (result) return result;
    }
    return null;
}

function findHiddenQuadrupletsInLineWithEliminations(pencilMarks, index, type) {
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

                    if (cellSet.size === 4) {
                        const quadDigits = new Set([d1, d2, d3, d4]);
                        const quadCells = [...cellSet].map(key => {
                            const [row, col] = key.split(',').map(Number);
                            return { row, col };
                        });

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
                                    return { type: 'hiddenQuadruplet', quadDigits: [d1, d2, d3, d4], eliminated, affectedCell: cell };
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

function findXWingWithEliminations() {
    const pencilMarks = getAllPencilMarksWithEliminations();
    for (let digit = 1; digit <= size; digit++) {
        const result = findXWingForDigitWithEliminations(pencilMarks, digit, 'row');
        if (result) return result;
        const result2 = findXWingForDigitWithEliminations(pencilMarks, digit, 'col');
        if (result2) return result2;
    }
    return null;
}

function findXWingForDigitWithEliminations(pencilMarks, digit, type) {
    // Find lines where digit appears in exactly 2 positions
    const linesWithTwo = [];
    for (let i = 0; i < size; i++) {
        const positions = [];
        for (let j = 0; j < size; j++) {
            const row = type === 'row' ? i : j;
            const col = type === 'row' ? j : i;
            const key = `${row},${col}`;
            if (pencilMarks.has(key) && pencilMarks.get(key).has(digit)) {
                positions.push(type === 'row' ? col : row);
            }
        }
        if (positions.length === 2) {
            linesWithTwo.push({ line: i, positions });
        }
    }

    // Find two lines with same positions
    for (let i = 0; i < linesWithTwo.length; i++) {
        for (let j = i + 1; j < linesWithTwo.length; j++) {
            if (linesWithTwo[i].positions[0] === linesWithTwo[j].positions[0] &&
                linesWithTwo[i].positions[1] === linesWithTwo[j].positions[1]) {
                // Found X-Wing! Check for eliminations in the crossing lines
                const pos1 = linesWithTwo[i].positions[0];
                const pos2 = linesWithTwo[i].positions[1];
                const line1 = linesWithTwo[i].line;
                const line2 = linesWithTwo[j].line;

                const eliminatedCells = [];
                for (const crossLine of [pos1, pos2]) {
                    for (let k = 0; k < size; k++) {
                        if (k === line1 || k === line2) continue;
                        const row = type === 'row' ? k : crossLine;
                        const col = type === 'row' ? crossLine : k;
                        const key = `${row},${col}`;
                        if (pencilMarks.has(key) && pencilMarks.get(key).has(digit)) {
                            eliminatedCells.push({ row, col });
                        }
                    }
                }

                if (eliminatedCells.length > 0) {
                    return { type: 'xWing', digit, eliminatedCells };
                }
            }
        }
    }
    return null;
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

function findNakedTriplets() {
    const pencilMarks = getAllPencilMarks();

    for (let row = 0; row < size; row++) {
        const result = findNakedTripletsInLine(pencilMarks, row, 'row');
        if (result) return result;
    }

    for (let col = 0; col < size; col++) {
        const result = findNakedTripletsInLine(pencilMarks, col, 'col');
        if (result) return result;
    }

    return null;
}

function findNakedTripletsInLine(pencilMarks, index, type) {
    const candidateCells = [];

    for (let i = 0; i < size; i++) {
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

    for (let i = 0; i < candidateCells.length; i++) {
        for (let j = i + 1; j < candidateCells.length; j++) {
            for (let k = j + 1; k < candidateCells.length; k++) {
                const combined = new Set([
                    ...candidateCells[i].marks,
                    ...candidateCells[j].marks,
                    ...candidateCells[k].marks
                ]);

                if (combined.size === 3) {
                    const tripletDigits = [...combined];
                    const tripletPositions = new Set([
                        `${candidateCells[i].row},${candidateCells[i].col}`,
                        `${candidateCells[j].row},${candidateCells[j].col}`,
                        `${candidateCells[k].row},${candidateCells[k].col}`
                    ]);

                    for (let m = 0; m < size; m++) {
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
                                return { type: 'nakedTriplet', tripletDigits, eliminated };
                            }
                        }
                    }
                }
            }
        }
    }

    return null;
}

function findNakedQuadruplets() {
    if (size < 7) return null;

    const pencilMarks = getAllPencilMarks();

    for (let row = 0; row < size; row++) {
        const result = findNakedQuadrupletsInLine(pencilMarks, row, 'row');
        if (result) return result;
    }

    for (let col = 0; col < size; col++) {
        const result = findNakedQuadrupletsInLine(pencilMarks, col, 'col');
        if (result) return result;
    }

    return null;
}

function findNakedQuadrupletsInLine(pencilMarks, index, type) {
    const candidateCells = [];

    for (let i = 0; i < size; i++) {
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
                        const quadDigits = [...combined];
                        const quadPositions = new Set([
                            `${candidateCells[i].row},${candidateCells[i].col}`,
                            `${candidateCells[j].row},${candidateCells[j].col}`,
                            `${candidateCells[k].row},${candidateCells[k].col}`,
                            `${candidateCells[l].row},${candidateCells[l].col}`
                        ]);

                        for (let m = 0; m < size; m++) {
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
                                    return { type: 'nakedQuadruplet', quadDigits, eliminated };
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

function findHiddenTriplets() {
    const pencilMarks = getAllPencilMarks();

    for (let row = 0; row < size; row++) {
        const result = findHiddenTripletsInLine(pencilMarks, row, 'row');
        if (result) return result;
    }

    for (let col = 0; col < size; col++) {
        const result = findHiddenTripletsInLine(pencilMarks, col, 'col');
        if (result) return result;
    }

    return null;
}

function findHiddenTripletsInLine(pencilMarks, index, type) {
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

                if (cellSet.size === 3) {
                    const tripletDigits = new Set([d1, d2, d3]);
                    const tripletCells = [...cellSet].map(key => {
                        const [row, col] = key.split(',').map(Number);
                        return { row, col };
                    });

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
                                return { type: 'hiddenTriplet', tripletDigits: [d1, d2, d3], eliminated };
                            }
                        }
                    }
                }
            }
        }
    }

    return null;
}

function findHiddenQuadruplets() {
    if (size < 7) return null;

    const pencilMarks = getAllPencilMarks();

    for (let row = 0; row < size; row++) {
        const result = findHiddenQuadrupletsInLine(pencilMarks, row, 'row');
        if (result) return result;
    }

    for (let col = 0; col < size; col++) {
        const result = findHiddenQuadrupletsInLine(pencilMarks, col, 'col');
        if (result) return result;
    }

    return null;
}

function findHiddenQuadrupletsInLine(pencilMarks, index, type) {
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

                    if (cellSet.size === 4) {
                        const quadDigits = new Set([d1, d2, d3, d4]);
                        const quadCells = [...cellSet].map(key => {
                            const [row, col] = key.split(',').map(Number);
                            return { row, col };
                        });

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
                                    return { type: 'hiddenQuadruplet', quadDigits: [d1, d2, d3, d4], eliminated };
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
