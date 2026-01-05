const express = require("express");
const app = express();
const cors = require("cors");
const path = require("path");
require("dotenv").config({ path: ".env" });
const session = require("express-session");
const morgan = require("morgan");
const MongoStore = require("connect-mongo");
const helmet = require("helmet");
const { connectDB } = require("./config/db");
const bodyParser = require("body-parser");
const authRoute = require("./routes/auth");
const cartRoutes = require('./routes/cart');
const notificationRoute = require("./routes/notification");
const expenditureRoute = require("./routes/expenditure");
const productRoute = require("./routes/product");
const reportRoute = require("./routes/report");
const debtRoute = require("./routes/debt");

connectDB();

const PORT = process.env.PORT || 5000;
const WEBSITE = process.env.WEBSITE_LINK || 'https://lomseb.swiftsyn.com';

const corsOptions = {
  origin: WEBSITE,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization", "cache-control", "pragma"],
  credentials: true,
  optionsSuccessStatus: 200,
};

app.use(cors());

app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ extended: false, limit: '200mb' }));
app.use(bodyParser.json());
app.use(helmet());
app.use(morgan("dev"));


app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_CONNECTION_URL }),
    cookie: {
      maxAge: 1000 * 60 * 60 * 24, // 1 day
    },
  })
);

// Routes
app.use("/api/v1/auth", authRoute);
app.use("/api/v1/cart", cartRoutes);
app.use("/api/v1/debt", debtRoute);
app.use("/api/v1/product", productRoute);
app.use("/api/v1/reports", reportRoute);
app.use("/api/v1/expenditures", expenditureRoute);
app.use("/api/v1/notification", notificationRoute);


app.get("/", (req, res) => {
  const filePath = path.join(__dirname, "client", "index.html");
  res.sendFile(filePath);
});

app.options("/api/v1/auth/update-profile-image", cors(corsOptions));
app.options("/api/v1/auth/register", cors(corsOptions));
app.options("/api/v1/product/", cors(corsOptions));
app.options("/api/v1/product/:id", cors(corsOptions));
app.options("/api/v1/cart/checkout", cors(corsOptions));
app.options("/api/v1/expenditures/statistics", cors(corsOptions));

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "An unexpected error occurred" });
});


app.listen(PORT, () => {
  console.log(`[+] Server running on port ${PORT}`);
});

process.on("SIGINT", async () => {
  console.log("[-] Sayonara...");
  process.exit(0);
});
