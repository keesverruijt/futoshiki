# Lightweight PHP-FPM container for Futoshiki Helper API
FROM php:8.2-fpm-alpine

# Install MySQL PDO extension
RUN docker-php-ext-install pdo pdo_mysql

# Create www directory structure
RUN mkdir -p /var/www/api

# Set working directory
WORKDIR /var/www

# Copy application files (these will be mounted as volumes in production)
# The actual files are served by nginx from a shared volume

EXPOSE 9000

CMD ["php-fpm"]
