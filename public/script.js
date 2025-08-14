// server/server.js (Final SQLite Version)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { getDatabaseConnection } = require('./database');

// Initialize Express App
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(cors({
    origin: [
        `http://localhost:${PORT}`, 
        `http://127.0.0.1:${PORT}`,
        'https://your-production-domain.com' // Add your production domain
    ],
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
        if (err) {
            console.error('JWT verification error:', err);
            return res.sendStatus(403);
        }
        req.user = user;
        next();
    });
}

// Helper Functions
async function analyzeSentiment(text) {
    try {
        // Simple sentiment analysis (replace with a real API if needed)
        const positiveWords = ['good', 'great', 'excellent', 'happy', 'love', 'like'];
        const negativeWords = ['bad', 'terrible', 'awful', 'hate', 'sad', 'angry'];
        
        const words = text.toLowerCase().match(/\b\w+\b/g) || [];
        let score = 0;
        
        words.forEach(word => {
            if (positiveWords.includes(word)) score += 0.1;
            if (negativeWords.includes(word)) score -= 0.1;
        });
        
        return {
            score: Math.max(-1, Math.min(1, score)),
            magnitude: Math.min(1, words.length * 0.05) // Scale with message length
        };
    } catch (error) {
        console.error('Sentiment analysis error:', error);
        return { score: 0, magnitude: 0 };
    }
}

// API Routes

// Health Check
app.get('/api/health', async (req, res) => {
    try {
        const db = await getDatabaseConnection();
        await db.get('SELECT 1'); // Simple query to test connection
        
        res.json({
            status: 'OK',
            database: 'SQLite',
            openRouterConfigured: !!process.env.OPENROUTER_API_KEY,
            uptime: process.uptime()
        });
    } catch (error) {
        console.error('Health check failed:', error);
        res.status(500).json({ status: 'Unhealthy', error: error.message });
    }
});

// User Registration
app.post('/api/signup', async (req, res) => {
    const { name, email, password } = req.body;
    
    // Basic validation
    if (!name || !email || !password) {
        return res.status(400).json({ error: 'All fields are required.' });
    }

    try {
        const db = await getDatabaseConnection();
        
        // Check if email exists
        const existingUser = await db.get(
            'SELECT id FROM Users WHERE email = ?', 
            [email]
        );
        
        if (existingUser) {
            return res.status(409).json({ error: 'Email already registered.' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Create user
        const result = await db.run(
            'INSERT INTO Users (name, email, password) VALUES (?, ?, ?)',
            [name, email, hashedPassword]
        );

        // Generate JWT token
        const token = jwt.sign(
            { userId: result.lastID }, 
            process.env.AUTH_SECRET, 
            { expiresIn: '24h' }
        );
        
        res.status(201).json({ 
            message: 'User registered successfully!', 
            userId: result.lastID,
            token,
            user: { name, email }
        });
    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ error: 'An error occurred during registration.' });
    }
});

// User Login
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
    }

    try {
        const db = await getDatabaseConnection();
        
        // Get user from database
        const user = await db.get(
            'SELECT id, name, email, password FROM Users WHERE email = ?', 
            [email]
        );
        
        if (!user) {
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        // Verify password
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        // Update last login time
        await db.run(
            'UPDATE Users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
            [user.id]
        );

        // Generate JWT token
        const token = jwt.sign(
            { userId: user.id }, 
            process.env.AUTH_SECRET, 
            { expiresIn: '24h' }
        );
        
        res.json({ 
            message: 'Logged in successfully!', 
            userId: user.id,
            token,
            user: {
                name: user.name,
                email: user.email
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'An error occurred during login.' });
    }
});

// Get User Profile
app.get('/api/user/:userId', authenticateToken, async (req, res) => {
    try {
        const db = await getDatabaseConnection();
        const user = await db.get(
            'SELECT id, name, email, created_at, last_login FROM Users WHERE id = ?',
            [req.params.userId]
        );
        
        if (!user) {
            return res.status(404).json({ error: 'User not found.' });
        }
        
        res.json(user);
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({ error: 'Failed to fetch user data.' });
    }
});

// AI Chat Endpoint
app.post('/api/chat', authenticateToken, async (req, res) => {
    const { userId, message, subject } = req.body;
    
    if (!message || !subject) {
        return res.status(400).json({ error: 'Message and subject are required.' });
    }

    try {
        const db = await getDatabaseConnection();
        
        // Get subject ID
        const subjectRow = await db.get(
            'SELECT id FROM Subjects WHERE name = ?',
            [subject]
        );
        
        if (!subjectRow) {
            return res.status(400).json({ error: 'Invalid subject.' });
        }
        
        const subjectId = subjectRow.id;
        let aiResponse;
        let usingFallback = true;

        // Call OpenRouter API if configured
        if (process.env.OPENROUTER_API_KEY) {
            try {
                const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                        'HTTP-Referer': `http://localhost:${PORT}/`
                    },
                    body: JSON.stringify({
                        model: process.env.OPENROUTER_MODEL_ID || 'openai/gpt-3.5-turbo',
                        messages: [{
                            role: "system",
                            content: `You are an expert tutor in ${subject}. Explain concepts clearly at a college level. Provide examples when helpful.`
                        }, {
                            role: "user",
                            content: message
                        }],
                        temperature: 0.7,
                        max_tokens: 1000
                    })
                });

                if (!response.ok) {
                    throw new Error(`API error: ${response.status}`);
                }

                const data = await response.json();
                aiResponse = data.choices?.[0]?.message?.content || "I couldn't generate a response.";
                usingFallback = false;
            } catch (apiError) {
                console.error('OpenRouter API error:', apiError);
                aiResponse = "I'm having trouble accessing my knowledge base. Please try again later.";
            }
        } else {
            // Fallback response
            aiResponse = `I'm here to help with ${subject}! ${message.includes('?') ? 
                "That's an interesting question. In this subject, we typically consider..." : 
                "Could you tell me more about what you're looking to understand?"}`;
        }

        // Store messages
        await db.run(
            'INSERT INTO ChatMessages (userId, subjectId, sender, text) VALUES (?, ?, ?, ?)',
            [userId, subjectId, 'user', message]
        );
        
        await db.run(
            'INSERT INTO ChatMessages (userId, subjectId, sender, text) VALUES (?, ?, ?, ?)',
            [userId, subjectId, 'ai', aiResponse]
        );

        // Analyze and store sentiment
        const sentiment = await analyzeSentiment(message);
        await db.run(
            'INSERT INTO MoodLogs (userId, subjectId, score, magnitude, message) VALUES (?, ?, ?, ?, ?)',
            [userId, subjectId, sentiment.score, sentiment.magnitude, message]
        );

        res.json({ 
            aiResponse, 
            sentiment,
            usingFallback 
        });
    } catch (error) {
        console.error('Chat error:', error);
        res.status(500).json({ error: 'An error occurred during chat processing.' });
    }
});

// Get Chat History
app.get('/api/history/:userId', authenticateToken, async (req, res) => {
    const { userId } = req.params;
    const { subject, limit } = req.query;
    
    if (!subject) {
        return res.status(400).json({ error: 'Subject is required.' });
    }

    try {
        const db = await getDatabaseConnection();
        
        const subjectRow = await db.get(
            'SELECT id FROM Subjects WHERE name = ?',
            [subject]
        );
        
        if (!subjectRow) {
            return res.status(400).json({ error: 'Invalid subject.' });
        }
        
        const query = `
            SELECT cm.id, cm.sender, cm.text, cm.timestamp, s.name as subject
            FROM ChatMessages cm
            JOIN Subjects s ON cm.subjectId = s.id
            WHERE cm.userId = ? AND cm.subjectId = ?
            ORDER BY cm.timestamp DESC
            ${limit ? 'LIMIT ?' : ''}
        `;
        
        const params = [userId, subjectRow.id];
        if (limit) params.push(parseInt(limit));
        
        const history = await db.all(query, params);
        
        res.json({ history: history.reverse() }); // Return in chronological order
    } catch (error) {
        console.error('History error:', error);
        res.status(500).json({ error: 'Failed to fetch chat history.' });
    }
});

// Get Mood Logs
app.get('/api/moodlogs/:userId', authenticateToken, async (req, res) => {
    const { userId } = req.params;
    const { days } = req.query;
    
    try {
        const db = await getDatabaseConnection();
        
        let query = `
            SELECT ml.id, s.name as subject, ml.score, ml.magnitude, 
                   ml.message, ml.timestamp
            FROM MoodLogs ml
            JOIN Subjects s ON ml.subjectId = s.id
            WHERE ml.userId = ?
        `;
        
        const params = [userId];
        
        if (days) {
            query += ' AND ml.timestamp >= datetime("now", ?)';
            params.push(`-${days} days`);
        }
        
        query += ' ORDER BY ml.timestamp DESC';
        
        const moodLogs = await db.all(query, params);
        
        res.json({ moodLogs });
    } catch (error) {
        console.error('Mood logs error:', error);
        res.status(500).json({ error: 'Failed to fetch mood logs.' });
    }
});

// Get All Subjects
app.get('/api/subjects', async (req, res) => {
    try {
        const db = await getDatabaseConnection();
        const subjects = await db.all('SELECT * FROM Subjects');
        res.json({ subjects });
    } catch (error) {
        console.error('Subjects error:', error);
        res.status(500).json({ error: 'Failed to fetch subjects.' });
    }
});

// Error Handling Middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// 404 Handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Start Server
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 Database: SQLite`);
    console.log(`🔐 Auth: JWT`);
    console.log(`🤖 OpenRouter: ${process.env.OPENROUTER_API_KEY ? 'Configured' : 'Not configured'}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down gracefully...');
    try {
        const db = await getDatabaseConnection();
        await db.close();
        console.log('✅ Database connection closed.');
        process.exit(0);
    } catch (err) {
        console.error('Error during shutdown:', err);
        process.exit(1);
    }
});