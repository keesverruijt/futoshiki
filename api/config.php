<?php
/**
 * Database configuration for Futoshiki Helper
 */

// Get database credentials from environment variables
$db_host = getenv('DB_HOST') ?: 'localhost';
$db_name = getenv('DB_NAME') ?: 'futoshiki';
$db_user = getenv('DB_USER') ?: 'futoshiki';
$db_pass = getenv('DB_PASS') ?: '';

// Allowed origins for CORS
$allowed_origins = [
    'https://verruijt.net',
    'https://www.verruijt.net'
];

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

// Check if request origin is allowed
function isAllowedOrigin() {
    global $allowed_origins;

    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $referer = $_SERVER['HTTP_REFERER'] ?? '';

    // Check Origin header
    if ($origin && in_array($origin, $allowed_origins)) {
        return $origin;
    }

    // Check Referer header as fallback
    foreach ($allowed_origins as $allowed) {
        if (strpos($referer, $allowed) === 0) {
            return $allowed;
        }
    }

    return false;
}

// Set JSON content type and CORS headers
function setJsonHeaders() {
    global $allowed_origins;

    header('Content-Type: application/json');

    $origin = isAllowedOrigin();
    if ($origin) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type');
        header('Vary: Origin');
    }

    // Handle preflight requests
    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
}

// Rate limiting using file-based storage (simple, no Redis needed)
function checkRateLimit($identifier, $maxRequests = 60, $windowSeconds = 60) {
    $rateLimitDir = sys_get_temp_dir() . '/futoshiki_ratelimit';
    if (!is_dir($rateLimitDir)) {
        @mkdir($rateLimitDir, 0755, true);
    }

    $file = $rateLimitDir . '/' . md5($identifier) . '.json';
    $now = time();

    $data = ['requests' => [], 'blocked_until' => 0];
    if (file_exists($file)) {
        $data = json_decode(file_get_contents($file), true) ?: $data;
    }

    // Check if blocked
    if ($data['blocked_until'] > $now) {
        return false;
    }

    // Remove old requests outside the window
    $data['requests'] = array_filter($data['requests'], function($t) use ($now, $windowSeconds) {
        return $t > ($now - $windowSeconds);
    });

    // Check rate limit
    if (count($data['requests']) >= $maxRequests) {
        $data['blocked_until'] = $now + $windowSeconds;
        file_put_contents($file, json_encode($data));
        return false;
    }

    // Add current request
    $data['requests'][] = $now;
    file_put_contents($file, json_encode($data));

    return true;
}

// Validate request origin for POST requests (extra security)
function validatePostRequest() {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        return true;
    }

    // Must have valid origin or referer
    if (!isAllowedOrigin()) {
        http_response_code(403);
        echo json_encode(['error' => 'Forbidden']);
        exit;
    }

    // Rate limit by IP
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    if (!checkRateLimit($ip, 30, 60)) { // 30 POSTs per minute max
        http_response_code(429);
        echo json_encode(['error' => 'Too many requests']);
        exit;
    }

    return true;
}
