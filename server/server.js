// server/server.js (Final Enhanced Version)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');

// In-memory store for PDF context
const userPdfContext = new Map();

// Initialize MySQL Database Connection
let dbPool;

async function connectToDbAndCreateTables() {
    try {
        dbPool = await mysql.createPool({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0
        });

        // Create tables if they don't exist (same as before)
        await dbPool.execute(`
            CREATE TABLE IF NOT EXISTS Users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) NOT NULL UNIQUE,
                password VARCHAR(255) NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
        `);

        await dbPool.execute(`
            CREATE TABLE IF NOT EXISTS ChatMessages (
                id INT AUTO_INCREMENT PRIMARY KEY,
                userId INT NOT NULL,
                subject VARCHAR(50) NOT NULL,
                sender ENUM('user', 'ai', 'system') NOT NULL,
                text TEXT NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                sentiment_score DECIMAL(3,2),
                sentiment_magnitude DECIMAL(3,2),
                FOREIGN KEY (userId) REFERENCES Users(id) ON DELETE CASCADE
            );
        `);

        await dbPool.execute(`
            CREATE TABLE IF NOT EXISTS MoodLogs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                userId INT NOT NULL,
                subject VARCHAR(50) NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                score DECIMAL(3,2) NOT NULL,
                magnitude DECIMAL(3,2) NOT NULL,
                message TEXT,
                FOREIGN KEY (userId) REFERENCES Users(id) ON DELETE CASCADE
            );
        `);

        console.log('Database tables verified/created');
    } catch (err) {
        console.error('Database connection error:', err);
        process.exit(1);
    }
}

connectToDbAndCreateTables();

// Initialize Express App
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(cors({
    origin: 'http://127.0.0.1:3000',
    credentials: true
}));

// Serve static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// JWT Authentication Middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) return res.sendStatus(401);
    
    jwt.verify(token, process.env.AUTH_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
}

// Helper Functions
async function analyzeSentiment(text) {
    return { score: 0, magnitude: 0 }; // Placeholder
}

// API Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// User Registration
app.post('/api/signup', async (req, res) => {
    const { name, email, password } = req.body;
    
    try {
        const [existingUsers] = await dbPool.execute('SELECT id FROM Users WHERE email = ?', [email]);
        if (existingUsers.length > 0) {
            return res.status(409).json({ error: 'Email already registered.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const [result] = await dbPool.execute(
            'INSERT INTO Users (name, email, password) VALUES (?, ?, ?)',
            [name, email, hashedPassword]
        );

        const token = jwt.sign({ userId: result.insertId }, process.env.AUTH_SECRET, { expiresIn: '24h' });
        res.status(201).json({ 
            message: 'User registered successfully!', 
            userId: result.insertId,
            token 
        });
    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ error: 'An error occurred during registration.' });
    }
});

// User Login
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    
    try {
        const [users] = await dbPool.execute('SELECT id, password FROM Users WHERE email = ?', [email]);
        if (users.length === 0) {
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        const user = users[0];
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        const token = jwt.sign({ userId: user.id }, process.env.AUTH_SECRET, { expiresIn: '24h' });
        res.json({ 
            message: 'Logged in successfully!', 
            userId: user.id,
            token 
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'An error occurred during login.' });
    }
});

// PDF Content Upload
app.post('/api/upload-pdf-content', authenticateToken, async (req, res) => {
    const { userId, subject, fileName, content } = req.body;
    
    if (!userPdfContext.has(userId)) {
        userPdfContext.set(userId, new Map());
    }
    userPdfContext.get(userId).set(subject, content);
    
    res.json({ message: 'PDF content stored for context.' });
});

// AI Chat Endpoint
app.post('/api/chat', authenticateToken, async (req, res) => {
    const { userId, message, subject } = req.body;
    let connection;
    
    try {
        connection = await dbPool.getConnection();
        
        // Get PDF context if available
        let pdfContext = '';
        if (userPdfContext.has(userId)) {
            const subjectMap = userPdfContext.get(userId);
            pdfContext = subjectMap.get(subject) || '';
        }

        // Call OpenRouter API
        const openRouterResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                'HTTP-Referer': 'http://127.0.0.1:3000/'
            },
            body: JSON.stringify({
                model: process.env.OPENROUTER_MODEL_ID,
                messages: [
                    {
                        role: "system",
                        content: `You are an expert tutor in ${subject}. Use the provided context when relevant. Be concise, clear, and encouraging.`
                    },
                    {
                        role: "user",
                        content: pdfContext 
                            ? `Context: ${pdfContext.substring(0, 1500)}\n\nQuestion: ${message}`
                            : message
                    }
                ],
                temperature: 0.7,
                max_tokens: 1000
            })
        });

        const orData = await openRouterResponse.json();
        const aiResponse = orData.choices?.[0]?.message?.content || "I couldn't generate a response.";

        // Store conversation and mood data
        await connection.execute(
            'INSERT INTO ChatMessages (userId, subject, sender, text) VALUES (?, ?, ?, ?)',
            [userId, subject, 'user', message]
        );
        await connection.execute(
            'INSERT INTO ChatMessages (userId, subject, sender, text) VALUES (?, ?, ?, ?)',
            [userId, subject, 'ai', aiResponse]
        );

        const sentiment = await analyzeSentiment(message);
        await connection.execute(
            'INSERT INTO MoodLogs (userId, subject, score, magnitude, message) VALUES (?, ?, ?, ?, ?)',
            [userId, subject, sentiment.score, sentiment.magnitude, message]
        );

        res.json({ aiResponse, sentiment });
    } catch (error) {
        console.error('Chat error:', error);
        res.status(500).json({ error: 'An error occurred during chat processing.' });
    } finally {
        if (connection) connection.release();
    }
});

// Chat History
app.get('/api/history/:userId', authenticateToken, async (req, res) => {
    const { userId } = req.params;
    const { subject } = req.query;
    
    try {
        const [rows] = await dbPool.execute(
            'SELECT * FROM ChatMessages WHERE userId = ? AND subject = ? ORDER BY timestamp ASC',
            [userId, subject]
        );
        res.json({ history: rows });
    } catch (error) {
        console.error('History error:', error);
        res.status(500).json({ error: 'Failed to fetch chat history.' });
    }
});

// Mood Logs
app.get('/api/moodlogs/:userId', authenticateToken, async (req, res) => {
    const { userId } = req.params;
    
    try {
        const [rows] = await dbPool.execute(
            'SELECT * FROM MoodLogs WHERE userId = ? ORDER BY timestamp DESC',
            [userId]
        );
        res.json({ moodLogs: rows });
    } catch (error) {
        console.error('Mood logs error:', error);
        res.status(500).json({ error: 'Failed to fetch mood logs.' });
    }
});

// Clear History
app.delete('/api/clear-history/:userId', authenticateToken, async (req, res) => {
    const { userId } = req.params;
    const { subject } = req.body;
    
    try {
        await dbPool.execute(
            'DELETE FROM ChatMessages WHERE userId = ? AND subject = ?',
            [userId, subject]
        );
        await dbPool.execute(
            'DELETE FROM MoodLogs WHERE userId = ? AND subject = ?',
            [userId, subject]
        );
        res.json({ message: 'History cleared successfully.' });
    } catch (error) {
        console.error('Clear history error:', error);
        res.status(500).json({ error: 'Failed to clear history.' });
    }
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server running on http://127.0.0.1:${PORT}`);
});