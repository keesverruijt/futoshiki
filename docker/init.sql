-- Futoshiki Helper Database Schema

CREATE TABLE IF NOT EXISTS stats (
    size INT PRIMARY KEY,
    completed INT DEFAULT 0,
    total_time BIGINT DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Initialize stats for all supported grid sizes (4-9)
INSERT INTO stats (size, completed, total_time) VALUES
    (4, 0, 0),
    (5, 0, 0),
    (6, 0, 0),
    (7, 0, 0),
    (8, 0, 0),
    (9, 0, 0)
ON DUPLICATE KEY UPDATE size = size;
