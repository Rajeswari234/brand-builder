<?php
// Local development storage only. Client exports do not contain this endpoint.
declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
function fail_request(int $status, string $message): void {
    http_response_code($status);
    echo json_encode(['error' => $message]);
    exit;
}
if (!in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true)) {
    fail_request(403, 'The editor file service is available only on this computer.');
}
$host = strtolower(explode(':', $_SERVER['HTTP_HOST'] ?? '')[0]);
if (!in_array($host, ['localhost', '127.0.0.1', '['], true)) {
    fail_request(403, 'Open the editor through localhost.');
}
$action = $_GET['action'] ?? 'list';
$root = __DIR__ . '/projects';
if (!is_dir($root) && !mkdir($root, 0775, true)) fail_request(500, 'Cannot create the project folder.');
function atomic_write(string $path, string $content): void {
    $temporary = tempnam(dirname($path), '.saving-');
    if ($temporary === false) throw new RuntimeException('Cannot create a temporary save file.');
    try {
        if (file_put_contents($temporary, $content, LOCK_EX) !== strlen($content)) {
            throw new RuntimeException('Could not write the complete file. Check disk space.');
        }
        if (!rename($temporary, $path)) throw new RuntimeException('Could not replace the saved file.');
    } finally {
        if (is_file($temporary)) unlink($temporary);
    }
}
try {
    if ($_SERVER['REQUEST_METHOD'] === 'GET' && $action === 'list') {
        $projects = [];
        foreach (glob($root . '/c*.json') ?: [] as $file) {
            $project = json_decode((string)file_get_contents($file), true, 512, JSON_THROW_ON_ERROR);
            if (isset($project['id'], $project['config'])) $projects[] = $project;
        }
        echo json_encode(['projects' => $projects], JSON_THROW_ON_ERROR);
        exit;
    }
    if ($_SERVER['REQUEST_METHOD'] !== 'POST' || ($_SERVER['HTTP_X_BRAND_BUILDER'] ?? '') !== 'local') {
        fail_request(405, 'Use the local editor to save projects.');
    }
    if (isset($_SERVER['HTTP_ORIGIN'])) {
        $origin = parse_url($_SERVER['HTTP_ORIGIN']);
        $expected = ($_SERVER['HTTPS'] ?? '') === 'on' ? 'https' : 'http';
        $originHost = ($origin['host'] ?? '') . (isset($origin['port']) ? ':' . $origin['port'] : '');
        if (($origin['scheme'] ?? '') !== $expected || $originHost !== ($_SERVER['HTTP_HOST'] ?? '')) {
            fail_request(403, 'Save requests must come from this local editor.');
        }
    }
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 64 * 1024 * 1024) {
        fail_request(413, 'This page is too large for local saving. Use Drive links for large files.');
    }
    $body = json_decode((string)file_get_contents('php://input'), true, 512, JSON_THROW_ON_ERROR);
    $id = $body['project']['id'] ?? $body['id'] ?? '';
    if (!is_string($id) || !preg_match('/^c[a-z0-9]{1,80}$/D', $id)) fail_request(400, 'Invalid client ID.');
    $directory = __DIR__ . '/clients/' . $id;
    if ($action === 'delete') {
        foreach ([$root . '/' . $id . '.json', $directory . '/index.html'] as $file) {
            if (is_file($file) && !unlink($file)) throw new RuntimeException('Could not remove the saved client.');
        }
        if (is_dir($directory)) rmdir($directory);
        echo json_encode(['deleted' => $id]);
        exit;
    }
    if ($action !== 'save') fail_request(400, 'Unknown action.');
    $project = $body['project'] ?? [];
    $html = $body['html'] ?? '';
    if (!isset($project['config']['client']['name']) || !is_string($html) || stripos($html, '<!doctype html>') !== 0) {
        fail_request(400, 'A client project and complete HTML page are required.');
    }
    if (!is_dir($directory) && !mkdir($directory, 0775, true)) throw new RuntimeException('Cannot create the client page folder.');
    atomic_write($directory . '/index.html', $html);
    atomic_write($root . '/' . $id . '.json', json_encode($project, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
    echo json_encode(['saved' => $id, 'path' => 'clients/' . $id . '/index.html']);
} catch (JsonException $error) {
    fail_request(400, 'Invalid project JSON.');
} catch (Throwable $error) {
    error_log('Brand Builder local storage: ' . $error->getMessage());
    fail_request(500, 'Could not save the local files. Check folder permissions and disk space.');
}
