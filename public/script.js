// DOM Elements
const authModal = document.getElementById('auth-modal');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const loginBtn = document.getElementById('login-btn');
const registerBtn = document.getElementById('register-btn');
const closeAuthModal = document.querySelector('.close-auth-modal');
const authTabs = document.querySelectorAll('.auth-tab');
const userProfile = document.getElementById('user-profile');
const userAvatar = document.getElementById('user-avatar');
const logoutBtn = document.getElementById('logout-btn');

// Chat elements
const chatInput = document.getElementById('chat-input');
const sendButton = document.getElementById('send-button');
const chatMessages = document.getElementById('chat-messages');
const typingIndicator = document.getElementById('typing-indicator');
const voiceBtn = document.getElementById('voice-btn');
const subjectLinks = document.querySelectorAll('.subject-list a');
const subjectBadge = document.querySelector('.subject-badge');
const chatTitle = document.querySelector('.chat-header h2');
const pdfUpload = document.getElementById('pdf-upload');

// App State
let currentUser = null;
let currentSubject = "Quantum Physics";
let authToken = null;

// Initialize the app
document.addEventListener('DOMContentLoaded', () => {
    // Check if user is already logged in
    const savedToken = localStorage.getItem('authToken');
    if (savedToken) {
        verifyToken(savedToken);
    }
    
    // Set up event listeners
    setupEventListeners();
});

function setupEventListeners() {
    // Auth modal triggers
    closeAuthModal.addEventListener('click', closeAuthModal);
    
    // Auth tab switching
    authTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            switchAuthTab(tabName);
        });
    });
    
    // Auth form submissions
    loginBtn.addEventListener('click', handleLogin);
    registerBtn.addEventListener('click', handleRegister);
    logoutBtn.addEventListener('click', handleLogout);
    
    // Chat input events
    chatInput.addEventListener('input', handleChatInput);
    chatInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (chatInput.value.trim() !== '') {
                sendMessage();
            }
        }
    });
    
    sendButton.addEventListener('click', sendMessage);
    
    // Subject selection events
    subjectLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();
            const subject = this.getAttribute('data-subject');
            changeSubject(subject);
        });
    });
    
    // Voice input events
    voiceBtn.addEventListener('click', toggleVoiceInput);
    
    // PDF upload event
    pdfUpload.addEventListener('change', handlePDFUpload);
}

// Auth Functions
function openAuthModal(defaultTab = 'login') {
    authModal.classList.remove('hidden');
    switchAuthTab(defaultTab);
}

function closeAuthModal() {
    authModal.classList.add('hidden');
}

function switchAuthTab(tabName) {
    authTabs.forEach(tab => {
        if (tab.dataset.tab === tabName) {
            tab.classList.add('active');
        } else {
            tab.classList.remove('active');
        }
    });
    
    if (tabName === 'login') {
        loginForm.classList.remove('hidden');
        registerForm.classList.add('hidden');
    } else {
        loginForm.classList.add('hidden');
        registerForm.classList.remove('hidden');
    }
}

async function handleLogin() {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value.trim();
    
    if (!email || !password) {
        alert('Please enter both email and password');
        return;
    }
    
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            authToken = data.token;
            currentUser = data.user;
            
            // Store token in localStorage
            localStorage.setItem('authToken', authToken);
            localStorage.setItem('user', JSON.stringify(currentUser));
            
            // Update UI
            updateAuthUI();
            closeAuthModal();
            
            // Load initial data
            loadInitialData();
        } else {
            alert(data.error || 'Login failed');
        }
    } catch (error) {
        console.error('Login error:', error);
        alert('An error occurred during login');
    }
}

async function handleRegister() {
    const name = document.getElementById('register-name').value.trim();
    const email = document.getElementById('register-email').value.trim();
    const password = document.getElementById('register-password').value.trim();
    
    if (!name || !email || !password) {
        alert('Please fill in all fields');
        return;
    }
    
    try {
        const response = await fetch('/api/signup', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name, email, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            alert('Registration successful! Please login.');
            switchAuthTab('login');
        } else {
            alert(data.error || 'Registration failed');
        }
    } catch (error) {
        console.error('Registration error:', error);
        alert('An error occurred during registration');
    }
}

function handleLogout() {
    // Clear auth data
    authToken = null;
    currentUser = null;
    localStorage.removeItem('authToken');
    localStorage.removeItem('user');
    
    // Update UI
    updateAuthUI();
    
    // Clear chat and other user-specific data
    resetAppState();
}

async function verifyToken(token) {
    try {
        const response = await fetch('/api/verify-token', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            authToken = token;
            currentUser = data.user;
            
            // Update UI
            updateAuthUI();
            
            // Load initial data
            loadInitialData();
        } else {
            localStorage.removeItem('authToken');
            localStorage.removeItem('user');
        }
    } catch (error) {
        console.error('Token verification error:', error);
        localStorage.removeItem('authToken');
        localStorage.removeItem('user');
    }
}

function updateAuthUI() {
    if (currentUser) {
        // User is logged in
        userProfile.classList.remove('hidden');
        userAvatar.textContent = currentUser.name.charAt(0).toUpperCase();
    } else {
        // User is logged out
        userProfile.classList.add('hidden');
        openAuthModal();
    }
}

function loadInitialData() {
    // Load user's chat history, mood data, etc.
    loadChatHistory();
    loadMoodData();
}

function resetAppState() {
    // Clear chat, reset subject, etc.
    document.getElementById('chat-messages').innerHTML = '';
    currentSubject = "Quantum Physics";
    updateSubjectUI();
}

// Chat Functions with OpenRouter Integration
async function sendMessageToAI(message) {
    if (!currentUser || !currentSubject) return null;
    
    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                userId: currentUser.id,
                message: message,
                subject: currentSubject
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            return data.aiResponse;
        } else {
            console.error('AI response error:', data.error);
            return "I encountered an error processing your request.";
        }
    } catch (error) {
        console.error('Chat error:', error);
        return "Sorry, I'm having trouble connecting to the AI service.";
    }
}

async function handlePDFUpload(event) {
    const file = event.target.files[0];
    if (!file || file.type !== 'application/pdf') {
        alert("Please upload a valid PDF file.");
        return;
    }

    const reader = new FileReader();
    reader.onload = async function() {
        try {
            const content = reader.result;
            
            const response = await fetch('/api/upload-pdf-content', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${authToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    userId: currentUser.id,
                    subject: currentSubject,
                    fileName: file.name,
                    content: content
                })
            });
            
            if (response.ok) {
                addMessageToChat('ai', `✅ PDF uploaded successfully! I can now reference this material for ${currentSubject}.`);
            } else {
                const errorData = await response.json();
                addMessageToChat('ai', `⚠️ Error uploading PDF: ${errorData.error || 'Unknown error'}`);
            }
        } catch (error) {
            console.error('PDF upload error:', error);
            addMessageToChat('ai', '⚠️ An error occurred while uploading the PDF.');
        }
    };
    reader.readAsDataURL(file);
}

// Existing chat UI functions
function sendMessage() {
    const messageText = chatInput.value.trim();
    if (messageText === '') return;
    
    // Add user message to chat
    addMessageToChat('user', messageText);
    chatInput.value = '';
    chatInput.style.height = 'auto';
    
    // Process message with AI
    processUserMessage(messageText);
}

function addMessageToChat(sender, text) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}-message`;
    
    const messageHeader = document.createElement('div');
    messageHeader.className = 'message-header';
    
    const messageSender = document.createElement('div');
    messageSender.className = 'message-sender';
    messageSender.textContent = sender === 'user' ? 'You' : 'Study Buddy';
    
    const messageTime = document.createElement('div');
    messageTime.className = 'message-time';
    messageTime.textContent = getCurrentTime();
    
    messageHeader.appendChild(messageSender);
    messageHeader.appendChild(messageTime);
    
    const messageContent = document.createElement('div');
    messageContent.className = 'message-content';
    messageContent.innerHTML = `<p>${text}</p>`;
    
    messageDiv.appendChild(messageHeader);
    messageDiv.appendChild(messageContent);
    
    if (sender === 'ai') {
        const messageActions = document.createElement('div');
        messageActions.className = 'message-actions';
        messageActions.innerHTML = `
            <button class="action-btn"><i class="fas fa-volume-up"></i> Listen</button>
            <button class="action-btn"><i class="fas fa-save"></i> Save</button>
        `;
        messageDiv.appendChild(messageActions);
    }
    
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function processUserMessage(message) {
    // Show typing indicator
    typingIndicator.style.display = 'flex';
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    // Get AI response from backend (which uses OpenRouter)
    const aiResponse = await sendMessageToAI(message);
    
    // Hide typing indicator and show response
    typingIndicator.style.display = 'none';
    addMessageToChat('ai', aiResponse);
    
    // Speak the response if available
    if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(aiResponse);
        speechSynthesis.speak(utterance);
    }
}

// Rest of your existing functions (getCurrentTime, changeSubject, etc.) remain the same