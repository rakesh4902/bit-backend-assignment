const express = require("express");
const app = express();
app.use(express.json());
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const path = require("path");
const dbPath = path.join(__dirname, "todoTasks.db");
let db = null;

const initializeDbAndServer = async () => {
  try {
    // Open SQLite database connection
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });

    // Start the server
    app.listen(3000, () => {
      console.log("Server is running...");
    });
  } catch (e) {
    console.log(`DB Error: ${e.message}`);
    process.exit(1);
  }
};

initializeDbAndServer();

// Registration endpoint
app.post("/register/", async (request, response) => {
  const { username, password } = request.body;

  // Check if the user already exists
  const selectUserQuery = `
    SELECT *
    FROM users
    WHERE username= '${username}';
  `;
  const dbUser = await db.get(selectUserQuery);

  if (dbUser !== undefined) {
    response.status(400);
    response.send("User already exists");
  } else {
    // Validate password length
    if (`${password}`.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      // Hash the password and insert the user
      const hashedPassword = await bcrypt.hash(`${password}`, 10);
      const insertQuery = `
        INSERT INTO users(username, password)
        VALUES ('${username}', '${hashedPassword}');
      `;
      await db.run(insertQuery);
      response.send("User created successfully");
    }
  }
});

// Login endpoint
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;

  // Check if the user exists
  const selectUserQuery = `
    SELECT *
    FROM users
    WHERE username= '${username}';
  `;
  const dbUser = await db.get(selectUserQuery);

  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    // Verify the password
    const isCorrectPassword = await bcrypt.compare(
      `${password}`,
      dbUser.password
    );

    if (!isCorrectPassword) {
      response.status(400);
      response.send("Invalid password");
    } else {
      // Generate and send JWT token on successful login
      const payload = { username: username };
      const jwtToken = jwt.sign(payload, "SECRET_KEY");
      response.status(200);
      response.send({ jwtToken });
    }
  }
});

// Middleware for authenticating JWT token
const authenticateToken = (request, response, next) => {
  const authHeader = request.headers["authorization"];
  let jwtToken = null;

  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];

    jwt.verify(jwtToken, "SECRET_KEY", (error, user) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = user.username;
        next();
      }
    });
  } else {
    response.status(401);
    response.send("Invalid JWT Token");
  }
};

// Function to get user ID by username
const getUserIdByUsername = async (username) => {
  const selectUserIdQuery = `
    SELECT id
    FROM users
    WHERE username = '${username}';
  `;
  const user = await db.get(selectUserIdQuery);
  return user ? user.id : null;
};

// CRUD operations for tasks
app.get("/tasks/", authenticateToken, async (request, response) => {
  // List all tasks
  const getTasksQuery = `
    SELECT *
    FROM tasks
    WHERE user_id = ${await getUserIdByUsername(request.username)};
  `;
  const tasksArray = await db.all(getTasksQuery);
  console.log(tasksArray);
  response.send(tasksArray);
});

app.get("/tasks/:tasksId", authenticateToken, async (request, response) => {
  // Retrieve a single task by ID
  const { tasksId } = request.params;
  console.log(tasksId);
  const getTasksQuery = `
    SELECT *
    FROM tasks
    WHERE id=${tasksId} AND user_id = ${await getUserIdByUsername(
    request.username
  )};
  `;
  const task = await db.get(getTasksQuery);
  console.log(task);

  if (task) {
    response.send(task);
  } else {
    response
      .status(403)
      .send("Permission denied. Task does not belong to the user.");
  }
});

app.post("/tasks", authenticateToken, async (req, res) => {
  // Create a new task
  const { title, description, due_date, status } = req.body;
  const user_id = await getUserIdByUsername(req.username);

  if (user_id !== null) {
    const insertTaskQuery = `
      INSERT INTO tasks(title, description, due_date, status, user_id)
      VALUES('${title}', '${description}', '${due_date}', '${status}', ${user_id});
    `;
    await db.run(insertTaskQuery);

    // Fetch the inserted task from the database
    const selectQuery = `SELECT * FROM tasks ORDER BY id DESC LIMIT 1`;
    const insertedTask = await db.get(selectQuery);

    // Send the inserted task as JSON response
    res.json({
      message: "Task inserted successfully",
      task: insertedTask,
    });
  } else {
    res.status(403).send("Permission denied. User not found.");
  }
});

app.put("/tasks/:tasksId", authenticateToken, async (req, res) => {
  // Update an existing task
  const { tasksId } = req.params;
  const { title, description, due_date, status } = req.body;
  const user_id = await getUserIdByUsername(req.username);

  if (user_id !== null) {
    const ownershipCheckQuery = `SELECT * FROM tasks WHERE id=${tasksId} AND user_id=${user_id}`;
    const ownedTask = await db.get(ownershipCheckQuery);

    if (ownedTask) {
      const updateQuery = `
        UPDATE tasks 
        SET title='${title}', description='${description}', due_date='${due_date}', status='${status}' 
        WHERE id=${tasksId};
      `;
      await db.run(updateQuery);

      // Fetch the updated task from the database
      const selectQuery = `SELECT * FROM tasks WHERE id=${tasksId}`;
      const updatedTask = await db.get(selectQuery);

      // Send the updated task as JSON response
      res.json({
        message: "Data Updated Successfully",
        updatedTask,
      });
    } else {
      res
        .status(403)
        .json({ message: "Permission denied. User does not own the task." });
    }
  } else {
    res.status(403).send("Permission denied. User not found.");
  }
});

app.delete("/tasks/:tasksId", authenticateToken, async (req, res) => {
  // Delete a task
  const { tasksId } = req.params;
  const user_id = await getUserIdByUsername(req.username);

  if (user_id !== null) {
    const ownershipCheckQuery = `SELECT * FROM tasks WHERE id=${tasksId} AND user_id=${user_id}`;
    const ownedTask = await db.get(ownershipCheckQuery);

    if (ownedTask) {
      // Fetch the task to be deleted
      const selectQuery = `SELECT * FROM tasks WHERE id = ${tasksId}`;
      const deletedTask = await db.get(selectQuery);

      // Delete the task from the database
      const deleteQuery = `DELETE FROM tasks WHERE id = ${tasksId}`;
      await db.run(deleteQuery);

      // Fetch the remaining tasks after deletion
      const remainingTasksQuery = `SELECT * FROM tasks WHERE user_id = ${user_id}`;
      const remainingTasks = await db.all(remainingTasksQuery);

      // Send a response with the remaining tasks and a success message
      res.json({
        message: "Task deleted successfully",
        deletedTask: deletedTask,
        remainingTasks: remainingTasks,
      });
    } else {
      res
        .status(403)
        .json({ message: "Permission denied. User does not own the task." });
    }
  } else {
    res.status(403).send("Permission denied. User not found.");
  }
});

module.exports = app;
