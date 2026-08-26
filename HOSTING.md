# Домовой — выкладка на Render (бесплатно, с iPad)

## 1. Аккаунт
1. Откройте https://render.com
2. Sign Up (Google / email)
3. Подтвердите почту

## 2. Загрузить код
Вариант А — через GitHub (удобнее):
1. Создайте репозиторий на https://github.com/new
2. Загрузите папку domovoy-prod (через GitHub сайт: Upload files)

Вариант Б — Render Blueprint / ручной Web Service из GitHub.

## 3. New Web Service
1. Dashboard → New → Web Service
2. Подключите репозиторий
3. Настройки:
   - Name: domovoy
   - Runtime: Python 3
   - Build Command: `pip install -r requirements.txt`
   - Start Command: `cd backend && PYTHONPATH=. uvicorn app.main:app --host 0.0.0.0 --port $PORT`
4. Plan: Free
5. Create Web Service

## 4. Ссылка
Через 2–5 минут появится:
https://domovoy-xxxx.onrender.com

Откройте на iPad и ТСД → «На экран Домой».

## Логины
- us000001 / admin123 (Админ)
- us000002 / sklad123 (Склад)
- us000003 / cleaner123 (Клинер)

## Важно про Free план
- После ~15 мин без запросов сервис «засыпает»
- Первый вход после сна — 30–60 сек
- Для постоянной работы без сна — платный план ($7/мес) или другой хостинг
