#!/bin/sh
# Автоматический скрипт настройки RaveLampa на бесплатном хостинге Serv00.com

echo "=== Настройка RaveLampa на Serv00 ==="

# 1. Разрешаем запуск собственных бинарников и фоновых процессов
devil binexec on

# 2. Определяем доступный npm (предпочтительно Node 22 или Node 20)
if command -v npm22 >/dev/null 2>&1; then
  NPM_CMD="npm22"
  NODE_CMD="node22"
elif command -v npm20 >/dev/null 2>&1; then
  NPM_CMD="npm20"
  NODE_CMD="node20"
else
  NPM_CMD="npm"
  NODE_CMD="node"
fi

echo "Используем: $NODE_CMD и $NPM_CMD"

# 3. Устанавливаем зависимости
$NPM_CMD install --omit=dev

echo "=== Готово! Зависимости установлены ==="
