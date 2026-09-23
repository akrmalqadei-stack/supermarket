const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.static(path.join(__dirname, "public")));

const DB_FILE = path.join(__dirname, "database.json");

function loadDB(){
  if (!fs.existsSync(DB_FILE)){
    const init = {
      users: [
        { id: 1, fullName: "مدير النظام", username: "admin", password: "admin123", role: "admin", branchId: null, active: true, target: 0 },
        { id: 2, fullName: "مدير الفرع", username: "manager", password: "manager123", role: "manager", branchId: 1, active: true, target: 0 },
        { id: 3, fullName: "كاشير 1", username: "cashier", password: "cashier123", role: "cashier", branchId: 1, active: true, target: 50000 }
      ],
      branches: [{ id: 1, name: "الفرع الرئيسي", address: "", phone: "" }],
      products: [
        { id: 101, branchId: 1, name: "أرز بسمتي 5 كجم", barcode: "1001", category: "مواد غذائية", buyPrice: 3500, sellPrice: 4200, quantity: 40, minStock: 10 },
        { id: 102, branchId: 1, name: "زيت طبخ 1.8 لتر", barcode: "1002", category: "مواد غذائية", buyPrice: 1800, sellPrice: 2300, quantity: 25, minStock: 8 },
        { id: 103, branchId: 1, name: "سكر 1 كجم", barcode: "1003", category: "مواد غذائية", buyPrice: 700, sellPrice: 950, quantity: 60, minStock: 15 }
      ],
      sales: [],
      customers: [],
      expenses: [],
      registers: [],
      settings: {
        storeName: "سوبرماركت النخبة",
        currency: "ريال",
        counter: 1000,
        taxRate: 0,
        logoUrl: "",
        phone: "",
        address: ""
      }
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(init, null, 2));
    return init;
  }
  const d = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  if (!d.customers) d.customers = [];
  if (!d.expenses) d.expenses = [];
  if (!d.registers) d.registers = [];
  return d;
}

function saveDB(d){ fs.writeFileSync(DB_FILE, JSON.stringify(d, null, 2)); }
let db = loadDB();

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  const u = db.users.find(x =>
    x.username.toLowerCase() === String(username).toLowerCase() &&
    x.password === password && x.active
  );
  if (!u) return res.status(401).json({ error: "بيانات غير صحيحة" });
  res.json({ user: u, settings: db.settings });
});

app.get("/api/data", (req, res) => {
  res.json({
    users: db.users,
    branches: db.branches,
    products: db.products,
    sales: db.sales,
    customers: db.customers,
    expenses: db.expenses,
    registers: db.registers,
    settings: db.settings
  });
});

app.post("/api/change", (req, res) => {
  const { type, payload } = req.body;
  try {
    const upsert = (arr) => {
      const i = arr.findIndex(x => x.id === payload.id);
      if (i >= 0) arr[i] = payload;
      else arr.push(payload);
    };

    if (type === "product.upsert") upsert(db.products);
    else if (type === "product.delete") db.products = db.products.filter(p => p.id !== payload.id);
    else if (type === "sale.upsert"){
      const i = db.sales.findIndex(s => s.id === payload.id);
      if (i >= 0) db.sales[i] = payload;
      else {
        db.sales.push(payload);
        payload.items.forEach(it => {
          const p = db.products.find(x => x.id === it.id);
          if (p) p.quantity -= it.qty;
        });
        if (payload.paymentMethod === "credit" && payload.customerId){
          const c = db.customers.find(x => x.id === payload.customerId);
          if (c) c.balance = (c.balance || 0) + payload.total;
        }
      }
    }
    else if (type === "sale.delete"){
      const s = db.sales.find(x => x.id === payload.id);
      if (s){
        s.items.forEach(it => {
          const p = db.products.find(x => x.id === it.id);
          if (p) p.quantity += it.qty;
        });
        if (s.paymentMethod === "credit" && s.customerId){
          const c = db.customers.find(x => x.id === s.customerId);
          if (c) c.balance = Math.max((c.balance || 0) - s.total, 0);
        }
        db.sales = db.sales.filter(x => x.id !== payload.id);
      }
    }
    else if (type === "user.upsert") upsert(db.users);
    else if (type === "user.delete") db.users = db.users.filter(u => u.id !== payload.id);
    else if (type === "branch.upsert") upsert(db.branches);
    else if (type === "branch.delete"){
      db.branches = db.branches.filter(b => b.id !== payload.id);
      db.products = db.products.filter(p => p.branchId !== payload.id);
      db.sales = db.sales.filter(s => s.branchId !== payload.id);
    }
    else if (type === "customer.upsert") upsert(db.customers);
    else if (type === "customer.delete") db.customers = db.customers.filter(c => c.id !== payload.id);
    else if (type === "expense.upsert") upsert(db.expenses);
    else if (type === "expense.delete") db.expenses = db.expenses.filter(e => e.id !== payload.id);
    else if (type === "register.upsert") upsert(db.registers);
    else if (type === "settings.update") db.settings = { ...db.settings, ...payload };

    saveDB(db);
    io.emit("sync", { type, ts: Date.now() });
    res.json({ ok: true });
  } catch(e){
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/clear-all", (req, res) => {
  db.products = [];
  db.sales = [];
  db.customers = [];
  db.expenses = [];
  db.registers = [];
  saveDB(db);
  io.emit("sync", { type: "clear" });
  res.json({ ok: true });
});

io.on("connection", socket => {
  console.log("✅ جهاز متصل:", socket.id);
  socket.on("disconnect", () => console.log("❌ جهاز انقطع"));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log("🛒 النظام العالمي يعمل على المنفذ " + PORT);
});