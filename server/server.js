// server/server.js (SQLite Version)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const fs = require('fs');

// In-memory store for PDF context
const userPdfContext = new Map();

// Initialize SQLite Database Connection
let db;

function connectToDatabase() {
    try {
        // Create database directory if it doesn't exist
        const dbDir = path.dirname(process.env.DB_PATH || './database/ai_study_buddy.db');
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }

        const dbPath = process.env.DB_PATH || './database/ai_study_buddy.db';
        db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.error('Database connection error:', err);
                process.exit(1);
            } else {
                console.log('✅ Connected to SQLite database');
                // Enable foreign key constraints
                db.run("PRAGMA foreign_keys = ON");
            }
        });
    } catch (err) {
        console.error('Database initialization error:', err);
        process.exit(1);
    }
}

connectToDatabase();

// Helper functions to promisify database operations
function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve({ id: this.lastID, changes: this.changes });
        });
    });
}

function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

// Initialize Express App
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(cors({
    origin: [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`],
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
    // Simple sentiment analysis placeholder
    // In production, you might use a service like Google Cloud Natural Language API
    const positiveWords = ['good', 'great', 'excellent', 'amazing', 'wonderful', 'fantastic', 'love', 'like', 'happy', 'excited'];
    const negativeWords = ['bad', 'terrible', 'awful', 'hate', 'dislike', 'sad', 'angry', 'frustrated', 'confused', 'difficult'];
    
    const words = text.toLowerCase().split(/\s+/);
    let score = 0;
    let magnitude = 0;
    
    words.forEach(word => {
        if (positiveWords.includes(word)) {
            score += 0.1;
            magnitude += 0.1;
        } else if (negativeWords.includes(word)) {
            score -= 0.1;
            magnitude += 0.1;
        }
    });
    
    return { 
        score: Math.max(-1, Math.min(1, score)), 
        magnitude: Math.min(1, magnitude) 
    };
}

// API Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// User Registration
app.post('/api/signup', async (req, res) => {
    const { name, email, password } = req.body;
    
    try {
        const existingUser = await dbGet('SELECT id FROM Users WHERE email = ?', [email]);
        if (existingUser) {
            return res.status(409).json({ error: 'Email already registered.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await dbRun(
            'INSERT INTO Users (name, email, password) VALUES (?, ?, ?)',
            [name, email, hashedPassword]
        );

        const token = jwt.sign({ userId: result.id }, process.env.AUTH_SECRET, { expiresIn: '24h' });
        res.status(201).json({ 
            message: 'User registered successfully!', 
            userId: result.id,
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
        const user = await dbGet('SELECT id, password FROM Users WHERE email = ?', [email]);
        if (!user) {
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

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
    
    try {
        if (!userPdfContext.has(userId)) {
            userPdfContext.set(userId, new Map());
        }
        userPdfContext.get(userId).set(subject, content);
        
        res.json({ message: 'PDF content stored for context.' });
    } catch (error) {
        console.error('PDF upload error:', error);
        res.status(500).json({ error: 'Failed to store PDF content.' });
    }
});

// AI Chat Endpoint
app.post('/api/chat', authenticateToken, async (req, res) => {
    const { userId, message, subject } = req.body;
    
    try {
        // Get PDF context if available
        let pdfContext = '';
        if (userPdfContext.has(userId)) {
            const subjectMap = userPdfContext.get(userId);
            pdfContext = subjectMap.get(subject) || '';
        }

        let aiResponse;

        // Call OpenRouter API if key is provided
        if (process.env.OPENROUTER_API_KEY) {
            try {
                const openRouterResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                        'HTTP-Referer': `http://localhost:${PORT}/`
                    },
                    body: JSON.stringify({
                        model: process.env.OPENROUTER_MODEL_ID || 'openai/gpt-3.5-turbo',
                        messages: [
                            {
                                role: "system",
                                content: `You are an expert tutor in ${subject}. Use the provided context when relevant. Be concise, clear, and encouraging. Help students understand concepts step by step.`
                            },
                            {
                                role: "user",
                                content: pdfContext 
                                    ? `Context from uploaded materials: ${pdfContext.substring(0, 1500)}\n\nStudent Question: ${message}`
                                    : message
                            }
                        ],
                        temperature: 0.7,
                        max_tokens: 1000
                    })
                });

                const orData = await openRouterResponse.json();
                aiResponse = orData.choices?.[0]?.message?.content || "I couldn't generate a response at the moment.";
            } catch (apiError) {
                console.error('OpenRouter API error:', apiError);
                aiResponse = `I'm having trouble connecting to my knowledge base right now. However, I can still help with ${subject}! Could you try rephrasing your question?`;
            }
        } else {
            // Fallback responses when no API key is configured
            const fallbackResponses = {
                "Quantum Physics": "I'd be happy to help with quantum physics! This is a fascinating field that deals with the behavior of matter and energy at the atomic scale. What specific concept would you like to explore?",
                "Molecular Biology": "Molecular biology is all about understanding life at the molecular level. I can help explain DNA, proteins, cellular processes, and more. What topic interests you?",
                "Advanced Calculus": "Calculus is a powerful mathematical tool! Whether it's derivatives, integrals, or multivariable calculus, I'm here to help break down complex concepts. What are you working on?",
                "Machine Learning": "Machine learning is an exciting field where we teach computers to learn patterns from data. I can help with algorithms, neural networks, and practical applications. What would you like to know?",
                "World Literature": "Literature opens windows to different cultures and human experiences. I can discuss authors, themes, literary movements, and help analyze texts. What work or topic interests you?",
                "Modern History": "History helps us understand how we got to where we are today. I can discuss events, movements, key figures, and historical analysis. What period or event would you like to explore?"
            };
            
            aiResponse = fallbackResponses[subject] || `I'm here to help with ${subject}! What specific topic or question do you have?`;
        }

        // Store conversation in database
        await dbRun(
            'INSERT INTO ChatMessages (userId, subject, sender, text) VALUES (?, ?, ?, ?)',
            [userId, subject, 'user', message]
        );
        await dbRun(
            'INSERT INTO ChatMessages (userId, subject, sender, text) VALUES (?, ?, ?, ?)',
            [userId, subject, 'ai', aiResponse]
        );

        const sentiment = await analyzeSentiment(message);
        await dbRun(
            'INSERT INTO MoodLogs (userId, subject, score, magnitude, message) VALUES (?, ?, ?, ?, ?)',
            [userId, subject, sentiment.score, sentiment.magnitude, message]
        );

        res.json({ aiResponse, sentiment });
    } catch (error) {
        console.error('Chat error:', error);
        res.status(500).json({ error: 'An error occurred during chat processing.' });
    }
});

// Chat History
app.get('/api/history/:userId', authenticateToken, async (req, res) => {
    const { userId } = req.params;
    const { subject } = req.query;
    
    try {
        const history = await dbAll(
            'SELECT * FROM ChatMessages WHERE userId = ? AND subject = ? ORDER BY timestamp ASC',
            [userId, subject]
        );
        res.json({ history });
    } catch (error) {
        console.error('History error:', error);
        res.status(500).json({ error: 'Failed to fetch chat history.' });
    }
});

// Mood Logs
app.get('/api/moodlogs/:userId', authenticateToken, async (req, res) => {
    const { userId } = req.params;
    
    try {
        const moodLogs = await dbAll(
            'SELECT * FROM MoodLogs WHERE userId = ? ORDER BY timestamp DESC',
            [userId]
        );
        res.json({ moodLogs });
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
        await dbRun(
            'DELETE FROM ChatMessages WHERE userId = ? AND subject = ?',
            [userId, subject]
        );
        await dbRun(
            'DELETE FROM MoodLogs WHERE userId = ? AND subject = ?',
            [userId, subject]
        );
        res.json({ message: 'History cleared successfully.' });
    } catch (error) {
        console.error('Clear history error:', error);
        res.status(500).json({ error: 'Failed to clear history.' });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        database: 'SQLite',
        openRouterConfigured: !!process.env.OPENROUTER_API_KEY
    });
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down gracefully...');
    db.close((err) => {
        if (err) {
            console.error('Error closing database:', err);
        } else {
            console.log('✅ Database connection closed.');
        }
        process.exit(0);
    });
});

// Start Server
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 Database: SQLite`);
    console.log(`🤖 OpenRouter API: ${process.env.OPENROUTER_API_KEY ? 'Configured' : 'Not configured (using fallback responses)'}`);
});