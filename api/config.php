<?php
/**
 * Database configuration for Futoshiki Helper
 */

// Get database credentials from environment variables
$db_host = getenv('DB_HOST') ?: 'localhost';
$db_name = getenv('DB_NAME') ?: 'futoshiki';
$db_user = getenv('DB_USER') ?: 'futoshiki';
$db_pass = getenv('DB_PASS') ?: '';

// Create PDO connection
function getDbConnection() {
    global $db_host, $db_name, $db_user, $db_pass;

    try {
        $pdo = new PDO(
            "mysql:host=$db_host;dbname=$db_name;charset=utf8mb4",
            $db_user,
            $db_pass,
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false
            ]
        );
        return $pdo;
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode(['error' => 'Database connection failed']);
        exit;
    }
}

// Set JSON content type and CORS headers
function setJsonHeaders() {
    header('Content-Type: application/json');
    header('Access-Control-Allow-Origin: https://verruijt.net');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');

    // Handle preflight requests
    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
}
