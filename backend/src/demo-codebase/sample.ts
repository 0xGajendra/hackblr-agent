// Sample file — replace with your own project files
// The agent will answer questions based on whatever code you put here

import express from "express";

const app = express();
app.use(express.json());

// User authentication endpoint
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  // TODO: Replace with real DB lookup
  const user = await findUserByEmail(email);
  if (!user) return res.status(401).json({ error: "User not found" });

  const isValid = await comparePasswords(password, user.passwordHash);
  if (!isValid) return res.status(401).json({ error: "Invalid password" });

  const token = generateJWT(user.id);
  res.json({ token });
});

async function findUserByEmail(email: string) {
  return null; // stub
}

async function comparePasswords(plain: string, hash: string) {
  return plain === hash; // stub
}

function generateJWT(userId: string) {
  return `token_${userId}_${Date.now()}`;
}

app.listen(3000);
