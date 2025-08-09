const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());


const DATA_FILE = path.join(__dirname, 'users.json');

let users = [];
if (fs.existsSync(DATA_FILE)) {
  try {
    const data = fs.readFileSync(DATA_FILE, 'utf8');
    users = JSON.parse(data);
  } catch (err) {
    console.error('Error reading users.json:', err);
    users = [];
  }
}

function saveUsers() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2), 'utf8');
}

app.post('/users', (req, res) => {
  users.push(req.body);
  saveUsers();
  res.json({ message: 'User added successfully' });
});

// Reading all users
app.get('/users', (req, res) => {
  res.json(users);
});

// Updating user by index
app.put('/users/:index', (req, res) => {
  const { index } = req.params;
  if (users[index]) {
    users[index] = req.body;
    saveUsers();
    res.json({ message: 'User updated successfully' });
  } else {
    res.status(404).json({ message: 'User not found' });
  }
});

// Deleting user by index
app.delete('/users/:index', (req, res) => {
  const { index } = req.params;
  if (users[index]) {
    users.splice(index, 1);
    saveUsers();
    res.json({ message: 'User deleted successfully' });
  } else {
    res.status(404).json({ message: 'User not found' });
  }
});

app.get('/', (req, res) => {
  res.json(users);
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
