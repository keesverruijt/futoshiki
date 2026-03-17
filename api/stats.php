<?php
/**
 * Stats API endpoint for Futoshiki Helper
 *
 * GET /api/stats.php?size=5  - Get stats for a specific grid size
 * POST /api/stats.php        - Update stats (increment completed count and add time)
 */

require_once __DIR__ . '/config.php';

setJsonHeaders();

$pdo = getDbConnection();

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    // Get stats for a specific size
    $size = isset($_GET['size']) ? (int)$_GET['size'] : 0;

    if ($size < 4 || $size > 9) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid size. Must be between 4 and 9.']);
        exit;
    }

    $stmt = $pdo->prepare('SELECT completed, total_time FROM stats WHERE size = ?');
    $stmt->execute([$size]);
    $row = $stmt->fetch();

    if ($row) {
        echo json_encode([
            'completed' => (int)$row['completed'],
            'totalTime' => (int)$row['total_time']
        ]);
    } else {
        echo json_encode([
            'completed' => 0,
            'totalTime' => 0
        ]);
    }

} elseif ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // Update stats - increment completed and add solve time
    $input = json_decode(file_get_contents('php://input'), true);

    if (!$input) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid JSON input']);
        exit;
    }

    $size = isset($input['size']) ? (int)$input['size'] : 0;
    $solveTime = isset($input['solveTime']) ? (int)$input['solveTime'] : 0;

    if ($size < 4 || $size > 9) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid size. Must be between 4 and 9.']);
        exit;
    }

    if ($solveTime < 0) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid solve time.']);
        exit;
    }

    // Atomic update using INSERT ... ON DUPLICATE KEY UPDATE
    $stmt = $pdo->prepare('
        INSERT INTO stats (size, completed, total_time)
        VALUES (?, 1, ?)
        ON DUPLICATE KEY UPDATE
            completed = completed + 1,
            total_time = total_time + VALUES(total_time)
    ');
    $stmt->execute([$size, $solveTime]);

    // Return updated stats
    $stmt = $pdo->prepare('SELECT completed, total_time FROM stats WHERE size = ?');
    $stmt->execute([$size]);
    $row = $stmt->fetch();

    echo json_encode([
        'success' => true,
        'completed' => (int)$row['completed'],
        'totalTime' => (int)$row['total_time']
    ]);

} else {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
}
