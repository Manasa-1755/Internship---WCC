const express = require('express');
const cors = require('cors');
const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

let users = [];

// Creating user
app.post('/users', (req, res) => {
  users.push(req.body);
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
    res.json({ message: 'User deleted successfully' });
  } else {
    res.status(404).json({ message: 'User not found' });
  }
});

const path = require('path');

app.get('/', (req, res) => {
  res.json(users);
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
