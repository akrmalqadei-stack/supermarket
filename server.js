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
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

const DB_FILE = path.join(__dirname, "database.json");

function loadDB(){
  if (!fs.existsSync(DB_FILE)){
    const init = {
      users: [
        { id: 1, fullName: "مدير النظام", username: "admin", password: "admin123", role: "admin", branchId: null, active: true },
        { id: 2, fullName: "مدير الفرع", username: "manager", password: "manager123", role: "manager", branchId: 1, active: true },
        { id: 3, fullName: "الكاشير", username: "cashier", password: "cashier123", role: "cashier", branchId: 1, active: true }
      ],
      branches: [{ id: 1, name: "الفرع الرئيسي", address: "صنعاء - شارع تعز", phone: "+967 1 234 567" }],
      products: [
        { id: 101, branchId: 1, name: "أرز بسمتي 5 كجم", barcode: "1001", category: "مواد غذائية", buyPrice: 3500, sellPrice: 4200, quantity: 40, minStock: 10 },
        { id: 102, branchId: 1, name: "زيت طبخ 1.8 لتر", barcode: "1002", category: "مواد غذائية", buyPrice: 1800, sellPrice: 2300, quantity: 25, minStock: 8 },
        { id: 103, branchId: 1, name: "سكر 1 كجم", barcode: "1003", category: "مواد غذائية", buyPrice: 700, sellPrice: 950, quantity: 60, minStock: 15 }
      ],
      sales: [],
      settings: { storeName: "سوبرماركت النخبة", currency: "ريال", counter: 1000 }
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(init, null, 2));
    return init;
  }
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function saveDB(d){ fs.writeFileSync(DB_FILE, JSON.stringify(d, null, 2)); }
let db = loadDB();

app.get("/", (req, res) => {
  let html = fs.readFileSync(path.join(__dirname, "public", "index.html"), "utf8");
  if (fs.existsSync(path.join(__dirname, "patch.html"))){
    const patch = fs.readFileSync(path.join(__dirname, "patch.html"), "utf8");
    html = html.replace("</body>", patch + "\n</body>");
  }
  if (fs.existsSync(path.join(__dirname, "patch2.html"))){
    const patch2 = fs.readFileSync(path.join(__dirname, "patch2.html"), "utf8");
    html = html.replace("</body>", patch2 + "\n</body>");
  }
  res.send(html);
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
  res.json({ users: db.users, branches: db.branches, products: db.products, sales: db.sales, settings: db.settings });
});

app.post("/api/change", (req, res) => {
  const { type, payload } = req.body;
  try {
    if (type === "product.upsert"){
      const i = db.products.findIndex(p => p.id === payload.id);
      if (i >= 0) db.products[i] = payload; else db.products.push(payload);
    }
    else if (type === "product.delete") db.products = db.products.filter(p => p.id !== payload.id);
    else if (type === "sale.upsert"){
      const i = db.sales.findIndex(s => s.id === payload.id);
      if (i >= 0) db.sales[i] = payload; else db.sales.push(payload);
      payload.items.forEach(it => {
        const p = db.products.find(x => x.id === it.id);
        if (p) p.quantity -= it.qty;
      });
    }
    else if (type === "sale.delete"){
      const s = db.sales.find(x => x.id === payload.id);
      if (s){
        s.items.forEach(it => {
          const p = db.products.find(x => x.id === it.id);
          if (p) p.quantity += it.qty;
        });
        db.sales = db.sales.filter(x => x.id !== payload.id);
      }
    }
    else if (type === "user.upsert"){
      const i = db.users.findIndex(u => u.id === payload.id);
      if (i >= 0) db.users[i] = payload; else db.users.push(payload);
    }
    else if (type === "user.delete") db.users = db.users.filter(u => u.id !== payload.id);
    else if (type === "branch.upsert"){
      const i = db.branches.findIndex(b => b.id === payload.id);
      if (i >= 0) db.branches[i] = payload; else db.branches.push(payload);
    }
    else if (type === "branch.delete"){
      db.branches = db.branches.filter(b => b.id !== payload.id);
      db.products = db.products.filter(p => p.branchId !== payload.id);
      db.sales = db.sales.filter(s => s.branchId !== payload.id);
    }
    else if (type === "settings.update") db.settings = { ...db.settings, ...payload };

    saveDB(db);
    io.emit("sync", { type, ts: Date.now() });
    res.json({ ok: true });
  } catch(e){
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/clear-all", (req, res) => {
  db.products = []; db.sales = [];
  saveDB(db);
  io.emit("sync", { type: "clear" });
  res.json({ ok: true });
});

io.on("connection", socket => {
  console.log("جهاز متصل:", socket.id);
  socket.on("disconnect", () => console.log("جهاز断开"));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log("نظام السوبرماركت يعمل الآن على المنفذ " + PORT);
});
