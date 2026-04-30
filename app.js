const DB_NAME = "ledgerlite-business";
const DB_VERSION = 2;
const STORES = ["customers", "suppliers", "products", "invoices", "purchases", "expenses", "inventoryMoves"];
const CURRENCY = "USD";

const navItems = [
  ["dashboard", "◧", "Dashboard"],
  ["customers", "◎", "Customers"],
  ["suppliers", "◇", "Suppliers"],
  ["products", "□", "Products/services/made"],
  ["invoices", "▤", "Invoices & payments"],
  ["purchases", "▧", "Purchases"],
  ["expenses", "◌", "Expenses"],
  ["inventory", "▦", "Inventory"],
  ["reports", "◫", "Reports"],
  ["settings", "⚙", "Settings"]
];

let db;
let deferredInstallPrompt;
const state = {
  view: "dashboard",
  data: Object.fromEntries(STORES.map(store => [store, []])),
  filters: {}
};

const $ = selector => document.querySelector(selector);
const view = $("#view");
const modalRoot = $("#modalRoot");
const toast = $("#toast");

function uid(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function money(value) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: CURRENCY }).format(Number(value || 0));
}

function num(value) {
  return Number.parseFloat(value || 0) || 0;
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      for (const store of STORES) {
        if (!database.objectStoreNames.contains(store)) {
          database.createObjectStore(store, { keyPath: "id" });
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx(store, mode = "readonly") {
  return db.transaction(store, mode).objectStore(store);
}

function getAll(store) {
  return new Promise((resolve, reject) => {
    const request = tx(store).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function put(store, record) {
  return new Promise((resolve, reject) => {
    const request = tx(store, "readwrite").put({ ...record, updatedAt: new Date().toISOString() });
    request.onsuccess = () => resolve(record);
    request.onerror = () => reject(request.error);
  });
}

function remove(store, id) {
  return new Promise((resolve, reject) => {
    const request = tx(store, "readwrite").delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function clearStore(store) {
  return new Promise((resolve, reject) => {
    const request = tx(store, "readwrite").clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function loadData() {
  for (const store of STORES) state.data[store] = await getAll(store);
}

function setPage(viewName) {
  state.view = viewName;
  document.body.classList.remove("nav-open");
  render();
}

function renderShell() {
  $("#nav").innerHTML = navItems.map(([id, icon, label]) => `
    <button type="button" class="${state.view === id ? "active" : ""}" data-nav="${id}">
      <span class="nav-icon">${icon}</span>${label}
    </button>
  `).join("");
  $("#nav").addEventListener("click", event => {
    const button = event.target.closest("[data-nav]");
    if (button) setPage(button.dataset.nav);
  });
  $("#menuBtn").addEventListener("click", () => document.body.classList.add("nav-open"));
  $("#drawerBackdrop").addEventListener("click", () => document.body.classList.remove("nav-open"));
}

function render() {
  const item = navItems.find(([id]) => id === state.view);
  $("#pageTitle").textContent = item?.[2] || "Dashboard";
  $("#eyebrow").textContent = item?.[2] || "Dashboard";
  document.querySelectorAll("[data-nav]").forEach(button => {
    button.classList.toggle("active", button.dataset.nav === state.view);
  });
  const renderers = {
    dashboard: renderDashboard,
    customers: renderCustomers,
    suppliers: renderSuppliers,
    products: renderProducts,
    invoices: renderInvoices,
    purchases: renderPurchases,
    expenses: renderExpenses,
    inventory: renderInventory,
    reports: renderReports,
    settings: renderSettings
  };
  renderers[state.view]();
}

function invoiceTotal(invoice) {
  const subtotal = invoiceSubtotal(invoice);
  const invoiceLevelDiscounts = num(invoice.discount) + num(invoice.customDeduction);
  return Math.max(0, subtotal - invoiceLevelDiscounts);
}

function invoiceSubtotal(invoice) {
  return (invoice.items || []).reduce((sum, item) => {
    const lineGross = num(item.qty) * num(item.price);
    return sum + Math.max(0, lineGross - num(item.discount));
  }, 0);
}

function invoicePaid(invoice) {
  return num(invoice.paid);
}

function invoiceStatus(invoice) {
  const total = invoiceTotal(invoice);
  const paid = invoicePaid(invoice);
  if (paid >= total && total > 0) return "Paid";
  if (paid > 0) return "Partial";
  if (invoice.dueDate && invoice.dueDate < today()) return "Overdue";
  return "Unpaid";
}

function statusPill(status) {
  const tone = { Paid: "ok", Partial: "warn", Overdue: "danger", Unpaid: "neutral" }[status] || "neutral";
  return `<span class="pill ${tone}">${esc(status)}</span>`;
}

function customerName(id) {
  return state.data.customers.find(customer => customer.id === id)?.name || "Walk-in customer";
}

function supplierName(id) {
  return state.data.suppliers.find(supplier => supplier.id === id)?.name || "Unknown supplier";
}

function productName(id) {
  return state.data.products.find(product => product.id === id)?.name || "Custom item";
}

function isService(product) {
  return product?.type === "Service";
}

function isMadeProduct(product) {
  return product?.type === "Made Product" || (!isService(product) && (product?.components || []).length > 0);
}

function isStockProduct(product) {
  return !isService(product) && !isMadeProduct(product);
}

function productTypeLabel(product) {
  if (isService(product)) return "Service";
  if (isMadeProduct(product)) return "Made Product";
  return "Product";
}

function productStock(product) {
  return productStockValue(product, new Set());
}

function productStockValue(product, seen) {
  if (isService(product)) return 0;
  if (!isMadeProduct(product)) return num(product.stock);
  if (!product?.id || seen.has(product.id)) return 0;
  seen.add(product.id);
  const components = product.components || [];
  if (!components.length) return 0;
  const possible = components.map(component => {
    const componentProduct = state.data.products.find(record => record.id === component.productId);
    const qtyNeeded = num(component.qty);
    if (!componentProduct || qtyNeeded <= 0) return 0;
    return Math.floor(productStockValue(componentProduct, new Set(seen)) / qtyNeeded);
  });
  return possible.length ? Math.min(...possible) : 0;
}

function productOptionsHtml(excludeId = "") {
  return state.data.products
    .filter(product => isStockProduct(product) && product.id !== excludeId)
    .map(product => `<option value="${product.id}">${esc(product.name)} (${esc(productStock(product))} on hand)</option>`)
    .join("");
}

function salesTotal(fromDate = null) {
  return state.data.invoices
    .filter(invoice => !fromDate || invoice.date >= fromDate)
    .reduce((sum, invoice) => sum + invoiceTotal(invoice), 0);
}

function paidTotal(fromDate = null) {
  return state.data.invoices
    .filter(invoice => !fromDate || invoice.date >= fromDate)
    .reduce((sum, invoice) => sum + invoicePaid(invoice), 0);
}

function expenseTotal(fromDate = null) {
  return state.data.expenses
    .filter(expense => !fromDate || expense.date >= fromDate)
    .reduce((sum, expense) => sum + num(expense.amount), 0);
}

function purchaseTotal(purchase) {
  return (purchase.items || []).reduce((sum, item) => sum + num(item.qty) * num(item.cost), 0);
}

function purchasePaid(purchase) {
  return num(purchase.paid);
}

function purchaseStatus(purchase) {
  const total = purchaseTotal(purchase);
  const paid = purchasePaid(purchase);
  if (paid >= total && total > 0) return "Paid";
  if (paid > 0) return "Partial";
  if (purchase.dueDate && purchase.dueDate < today()) return "Overdue";
  return "Unpaid";
}

function purchaseReceiveStatus(purchase) {
  if (!purchase) return "Ordered";
  return purchase.receiveStatus || "Received";
}

function receiveStatusPill(purchase) {
  const status = purchaseReceiveStatus(purchase);
  const tone = status === "Received" ? "ok" : "warn";
  return `<span class="pill ${tone}">${esc(status)}</span>`;
}

function purchaseTotalForPeriod(fromDate = null) {
  return state.data.purchases
    .filter(purchase => !fromDate || purchase.date >= fromDate)
    .reduce((sum, purchase) => sum + purchaseTotal(purchase), 0);
}

function purchasePaidTotal(fromDate = null) {
  return state.data.purchases
    .filter(purchase => !fromDate || purchase.date >= fromDate)
    .reduce((sum, purchase) => sum + purchasePaid(purchase), 0);
}

function overdueInvoices() {
  return state.data.invoices.filter(invoice => invoiceStatus(invoice) === "Overdue");
}

function lowStockProducts() {
  return state.data.products.filter(product => !isService(product) && productStock(product) <= num(product.minStock));
}

function renderDashboard() {
  const monthStart = today().slice(0, 8) + "01";
  const recentInvoices = [...state.data.invoices].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 6);
  const recentPurchases = [...state.data.purchases].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 5);
  const recentExpenses = [...state.data.expenses].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 6);
  const lowStock = lowStockProducts().slice(0, 6);
  const totalIn = paidTotal();
  const totalOut = purchasePaidTotal() + expenseTotal();
  const monthIn = paidTotal(monthStart);
  const monthOut = purchasePaidTotal(monthStart) + expenseTotal(monthStart);
  const openPayables = state.data.purchases.reduce((sum, purchase) => sum + Math.max(0, purchaseTotal(purchase) - purchasePaid(purchase)), 0);
  const openReceivables = state.data.invoices.reduce((sum, invoice) => sum + Math.max(0, invoiceTotal(invoice) - invoicePaid(invoice)), 0);

  view.innerHTML = `
    <div class="grid cols-4">
      ${metric("Sales this month", money(salesTotal(monthStart)), `${state.data.invoices.length} total invoices`)}
      ${metric("Payments received", money(monthIn), "Cash collected this month")}
      ${metric("Purchases this month", money(purchaseTotalForPeriod(monthStart)), "Stock and supplier buying")}
      ${metric("Expenses this month", money(expenseTotal(monthStart)), "Operating costs recorded")}
    </div>
    <div class="grid cols-4" style="margin-top:16px">
      ${metric("This month net", money(monthIn - monthOut), "Money in minus money out")}
      ${metric("Supplier payments", money(purchasePaidTotal(monthStart)), "Paid to suppliers this month")}
      ${metric("Open payables", money(openPayables), "Unpaid supplier balances")}
      ${metric("Open receivables", money(openReceivables), "Unpaid customer balances")}
    </div>
    <div class="grid cols-4" style="margin-top:16px">
      ${metric("Total money in", money(totalIn), "All customer payments received")}
      ${metric("Total money out", money(totalOut), "All supplier payments plus expenses")}
      ${metric("Total expenses", money(expenseTotal()), "All operating expenses recorded")}
      ${metric("Total purchases", money(purchaseTotalForPeriod()), "All supplier purchases recorded")}
    </div>
    <div class="grid cols-4" style="margin-top:16px">
      ${metric("All-time net", money(totalIn - totalOut), "Total in minus total out")}
      ${metric("Total invoiced", money(salesTotal()), "All sales invoices created")}
      ${metric("Purchase payments", money(purchasePaidTotal()), "All money paid to suppliers")}
      ${metric("Total records", String(state.data.invoices.length + state.data.purchases.length + state.data.expenses.length), "Invoices, purchases, and expenses")}
    </div>
    <div class="grid cols-2" style="margin-top:16px">
      <section class="table-card">
        <div class="card"><h2>Recent invoices</h2></div>
        ${recentInvoices.length ? invoiceTable(recentInvoices, false) : empty("No invoices yet", "Create an invoice to start tracking sales and payments.")}
      </section>
      <section class="table-card">
        <div class="card"><h2>Recent purchases</h2></div>
        ${recentPurchases.length ? purchaseTable(recentPurchases, false) : empty("No purchases yet", "Record supplier purchases to increase stock and track payables.")}
      </section>
    </div>
    <div class="grid cols-2" style="margin-top:16px">
      <section class="table-card">
        <div class="card"><h2>Recent expenses</h2></div>
        ${recentExpenses.length ? expenseTable(recentExpenses, false) : empty("No expenses recorded", "Add expenses to track operating costs on the dashboard.")}
      </section>
      <section class="table-card">
        <div class="card"><h2>Open supplier balances</h2></div>
        ${supplierBalances().length ? table(["Supplier", "Balance"], supplierBalances().slice(0, 6).map(item => [esc(item.name), money(item.balance)])) : empty("No supplier balances", "Unpaid purchase balances will appear here.")}
      </section>
    </div>
    <div class="grid cols-2" style="margin-top:16px">
      <section class="table-card">
        <div class="card"><h2>Stock needing attention</h2></div>
        ${lowStock.length ? productTable(lowStock, false) : empty("Stock looks healthy", "Products above their minimum level will stay out of this list.")}
      </section>
      <section class="table-card">
        <div class="card"><h2>Expense categories</h2></div>
        ${expenseCategorySummary(monthStart).length ? table(["Category", "This month"], expenseCategorySummary(monthStart).slice(0, 8).map(item => [esc(item.category), money(item.total)])) : empty("No expense categories", "Expense category totals will appear here.")}
      </section>
    </div>
    <div class="grid cols-3" style="margin-top:16px">
      <button class="primary" type="button" data-action="quick-invoice">New invoice</button>
      <button class="secondary" type="button" data-action="quick-purchase">Record purchase</button>
      <button class="secondary" type="button" data-action="quick-expense">Add expense</button>
    </div>
  `;
  view.querySelector("[data-action='quick-invoice']").addEventListener("click", () => openInvoiceModal());
  view.querySelector("[data-action='quick-purchase']").addEventListener("click", () => openPurchaseModal());
  view.querySelector("[data-action='quick-expense']").addEventListener("click", () => openExpenseModal());
}

function metric(label, value, hint) {
  return `<div class="card metric"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(hint)}</small></div>`;
}

function empty(title, body) {
  return `<div class="empty-state"><strong>${esc(title)}</strong>${esc(body)}</div>`;
}

function toolbar(searchKey, placeholder, addText, addHandler) {
  return `
    <div class="toolbar">
      <input class="search" data-search="${searchKey}" type="search" placeholder="${esc(placeholder)}" value="${esc(state.filters[searchKey] || "")}">
      <div class="toolbar-actions">
        <button class="primary" type="button" data-add="${searchKey}">${esc(addText)}</button>
      </div>
    </div>
  `;
}

function bindSearch(searchKey, addHandler) {
  view.querySelector(`[data-search="${searchKey}"]`)?.addEventListener("input", event => {
    state.filters[searchKey] = event.target.value;
    render();
  });
  view.querySelector(`[data-add="${searchKey}"]`)?.addEventListener("click", addHandler);
}

function includesText(record, query) {
  if (!query) return true;
  return JSON.stringify(record).toLowerCase().includes(query.toLowerCase());
}

function renderCustomers() {
  const query = state.filters.customers || "";
  const customers = state.data.customers.filter(customer => includesText(customer, query));
  view.innerHTML = toolbar("customers", "Search customers by name, phone, email, address", "Add customer") +
    (customers.length ? customerTable(customers) : empty("No customers found", "Add customers to track invoices, balances, and contact details."));
  bindSearch("customers", () => openCustomerModal());
  view.querySelectorAll("[data-edit-customer]").forEach(button => button.addEventListener("click", () => {
    openCustomerModal(state.data.customers.find(customer => customer.id === button.dataset.editCustomer));
  }));
  view.querySelectorAll("[data-delete-customer]").forEach(button => button.addEventListener("click", async () => {
    if (!confirm("Delete this customer? Existing invoices will keep their customer name as walk-in if needed.")) return;
    await remove("customers", button.dataset.deleteCustomer);
    await loadData();
    render();
    showToast("Customer deleted");
  }));
}

function customerTable(customers) {
  return table(["Name", "Contact", "Open balance", "Notes", ""], customers.map(customer => {
    const invoices = state.data.invoices.filter(invoice => invoice.customerId === customer.id);
    const balance = invoices.reduce((sum, invoice) => sum + invoiceTotal(invoice) - invoicePaid(invoice), 0);
    return [
      `<strong>${esc(customer.name)}</strong><br><span class="muted">${esc(customer.address || "")}</span>`,
      `${esc(customer.phone || "-")}<br><span class="muted">${esc(customer.email || "")}</span>`,
      money(balance),
      esc(customer.notes || "-"),
      rowActions("customer", customer.id)
    ];
  }));
}

function renderSuppliers() {
  const query = state.filters.suppliers || "";
  const suppliers = state.data.suppliers.filter(supplier => includesText(supplier, query));
  view.innerHTML = toolbar("suppliers", "Search suppliers by name, phone, email, address", "Add supplier") +
    (suppliers.length ? supplierTable(suppliers) : empty("No suppliers found", "Add suppliers to record purchases, track payables, and manage buying history."));
  bindSearch("suppliers", () => openSupplierModal());
  view.querySelectorAll("[data-edit-supplier]").forEach(button => button.addEventListener("click", () => {
    openSupplierModal(state.data.suppliers.find(supplier => supplier.id === button.dataset.editSupplier));
  }));
  view.querySelectorAll("[data-delete-supplier]").forEach(button => button.addEventListener("click", async () => {
    if (!confirm("Delete this supplier? Existing purchases will show as unknown supplier.")) return;
    await remove("suppliers", button.dataset.deleteSupplier);
    await loadData();
    render();
    showToast("Supplier deleted");
  }));
}

function supplierTable(suppliers) {
  return table(["Name", "Contact", "Open balance", "Notes", ""], suppliers.map(supplier => {
    const purchases = state.data.purchases.filter(purchase => purchase.supplierId === supplier.id);
    const balance = purchases.reduce((sum, purchase) => sum + purchaseTotal(purchase) - purchasePaid(purchase), 0);
    return [
      `<strong>${esc(supplier.name)}</strong><br><span class="muted">${esc(supplier.address || "")}</span>`,
      `${esc(supplier.phone || "-")}<br><span class="muted">${esc(supplier.email || "")}</span>`,
      money(balance),
      esc(supplier.notes || "-"),
      rowActions("supplier", supplier.id)
    ];
  }));
}

function supplierBalances() {
  return state.data.suppliers.map(supplier => {
    const balance = state.data.purchases
      .filter(purchase => purchase.supplierId === supplier.id)
      .reduce((sum, purchase) => sum + purchaseTotal(purchase) - purchasePaid(purchase), 0);
    return { name: supplier.name, balance };
  }).filter(item => item.balance > 0).sort((a, b) => b.balance - a.balance);
}

function renderProducts() {
  const query = state.filters.products || "";
  const products = state.data.products.filter(product => includesText(product, query));
  view.innerHTML = toolbar("products", "Search products, services, SKU, category", "Add product/service") +
    (products.length ? productTable(products) : empty("No products or services", "Add products for inventory tracking or services for fast invoicing."));
  bindSearch("products", () => openProductModal());
  view.querySelectorAll("[data-edit-product]").forEach(button => button.addEventListener("click", () => {
    openProductModal(state.data.products.find(product => product.id === button.dataset.editProduct));
  }));
  view.querySelectorAll("[data-delete-product]").forEach(button => button.addEventListener("click", async () => {
    if (!confirm("Delete this product/service? Existing invoices will keep their line item details.")) return;
    await remove("products", button.dataset.deleteProduct);
    await loadData();
    render();
    showToast("Product/service deleted");
  }));
}

function productTable(products, actions = true) {
  return table(["Item", "Type", "Price", "Stock", "Minimum", "Recipe", actions ? "" : "Status"], products.map(product => {
    const stock = productStock(product);
    const isLow = !isService(product) && stock <= num(product.minStock);
    return [
      `<strong>${esc(product.name)}</strong><br><span class="muted">${esc(product.sku || "No SKU")} ${product.category ? " · " + esc(product.category) : ""}</span>`,
      esc(productTypeLabel(product)),
      money(product.price),
      isService(product) ? "Not stocked" : `${esc(stock)}${isMadeProduct(product) ? " available" : ""}`,
      isService(product) ? "-" : esc(product.minStock || 0),
      esc(recipeText(product)),
      actions ? rowActions("product", product.id) : (isLow ? `<span class="pill warn">Low stock</span>` : `<span class="pill ok">OK</span>`)
    ];
  }));
}

function recipeText(product) {
  return (product.components || [])
    .map(component => `${productName(component.productId)} x ${num(component.qty)}`)
    .join(", ") || "-";
}

function renderInvoices() {
  const query = state.filters.invoices || "";
  const invoices = state.data.invoices.filter(invoice => includesText({ ...invoice, customer: customerName(invoice.customerId) }, query));
  invoices.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  view.innerHTML = toolbar("invoices", "Search invoices by number, customer, status", "New invoice") +
    (invoices.length ? invoiceTable(invoices) : empty("No invoices yet", "Create invoices, record payments, and let product stock update automatically."));
  bindSearch("invoices", () => openInvoiceModal());
  view.querySelectorAll("[data-edit-invoice]").forEach(button => button.addEventListener("click", () => {
    openInvoiceModal(state.data.invoices.find(invoice => invoice.id === button.dataset.editInvoice));
  }));
  view.querySelectorAll("[data-pay-invoice]").forEach(button => button.addEventListener("click", () => openPaymentModal(button.dataset.payInvoice)));
  view.querySelectorAll("[data-delete-invoice]").forEach(button => button.addEventListener("click", async () => {
    const invoice = state.data.invoices.find(item => item.id === button.dataset.deleteInvoice);
    if (!invoice || !confirm("Delete this invoice and restore stock quantities?")) return;
    await applyInvoiceStock(invoice, 1);
    await remove("invoices", invoice.id);
    await loadData();
    render();
    showToast("Invoice deleted and stock restored");
  }));
}

function invoiceTable(invoices, actions = true) {
  return table(["Invoice", "Customer", "Date", "Total", "Paid", "Status", actions ? "" : "Due"], invoices.map(invoice => {
    const status = invoiceStatus(invoice);
    return [
      `<strong>${esc(invoice.number)}</strong><br><span class="muted">Due ${esc(invoice.dueDate || "-")}</span>`,
      esc(customerName(invoice.customerId)),
      esc(invoice.date || "-"),
      money(invoiceTotal(invoice)),
      money(invoicePaid(invoice)),
      statusPill(status),
      actions ? `
        <div class="inline-actions">
          ${actionButton("edit", "Edit invoice", `data-edit-invoice="${invoice.id}"`)}
          ${actionButton("pay", "Record payment", `data-pay-invoice="${invoice.id}"`)}
          ${actionButton("delete", "Delete invoice", `data-delete-invoice="${invoice.id}"`, "danger")}
        </div>` : money(invoiceTotal(invoice) - invoicePaid(invoice))
    ];
  }));
}

function renderPurchases() {
  const query = state.filters.purchases || "";
  const purchases = state.data.purchases.filter(purchase => includesText({ ...purchase, supplier: supplierName(purchase.supplierId) }, query));
  purchases.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  view.innerHTML = toolbar("purchases", "Search purchases by bill number, supplier, status", "Record purchase") +
    (purchases.length ? purchaseTable(purchases) : empty("No purchases recorded", "Record items bought from suppliers to update stock and track supplier payments."));
  bindSearch("purchases", () => openPurchaseModal());
  view.querySelectorAll("[data-edit-purchase]").forEach(button => button.addEventListener("click", () => {
    openPurchaseModal(state.data.purchases.find(purchase => purchase.id === button.dataset.editPurchase));
  }));
  view.querySelectorAll("[data-pay-purchase]").forEach(button => button.addEventListener("click", () => openPurchasePaymentModal(button.dataset.payPurchase)));
  view.querySelectorAll("[data-receive-purchase]").forEach(button => button.addEventListener("click", async () => {
    const purchase = state.data.purchases.find(item => item.id === button.dataset.receivePurchase);
    if (!purchase || !confirm("Mark this purchase as received and add its items to inventory?")) return;
    purchase.receiveStatus = "Received";
    purchase.receivedAt = new Date().toISOString();
    await put("purchases", purchase);
    await applyPurchaseStock(purchase, 1);
    await loadData();
    render();
    showToast("Purchase received and inventory updated");
  }));
  view.querySelectorAll("[data-delete-purchase]").forEach(button => button.addEventListener("click", async () => {
    const purchase = state.data.purchases.find(item => item.id === button.dataset.deletePurchase);
    if (!purchase || !confirm("Delete this purchase? Received orders will remove their stock quantities.")) return;
    if (purchaseReceiveStatus(purchase) === "Received") await applyPurchaseStock(purchase, -1);
    await remove("purchases", purchase.id);
    await loadData();
    render();
    showToast("Purchase deleted and stock adjusted");
  }));
}

function purchaseTable(purchases, actions = true) {
  return table(["Purchase", "Supplier", "Items", "Date", "Received", "Total", "Paid", "Status", actions ? "" : "Due"], purchases.map(purchase => {
    const status = purchaseStatus(purchase);
    return [
      `<strong>${esc(purchase.number)}</strong><br><span class="muted">Due ${esc(purchase.dueDate || "-")}</span>`,
      esc(supplierName(purchase.supplierId)),
      esc(purchaseItemsText(purchase)),
      esc(purchase.date || "-"),
      receiveStatusPill(purchase),
      money(purchaseTotal(purchase)),
      money(purchasePaid(purchase)),
      statusPill(status),
      actions ? `
        <div class="inline-actions">
          ${actionButton("edit", "Edit purchase", `data-edit-purchase="${purchase.id}"`)}
          ${purchaseReceiveStatus(purchase) === "Received" ? "" : actionButton("receive", "Receive order", `data-receive-purchase="${purchase.id}"`, "primary")}
          ${actionButton("pay", "Record supplier payment", `data-pay-purchase="${purchase.id}"`)}
          ${actionButton("delete", "Delete purchase", `data-delete-purchase="${purchase.id}"`, "danger")}
        </div>` : money(purchaseTotal(purchase) - purchasePaid(purchase))
    ];
  }));
}

function purchaseItemsText(purchase) {
  return (purchase.items || [])
    .map(item => `${item.description || productName(item.productId)} x ${num(item.qty)}`)
    .join(", ") || "-";
}

function renderExpenses() {
  const query = state.filters.expenses || "";
  const expenses = state.data.expenses.filter(expense => includesText(expense, query));
  expenses.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  view.innerHTML = toolbar("expenses", "Search expenses by category, vendor, method", "Add expense") +
    (expenses.length ? expenseTable(expenses) : empty("No expenses recorded", "Track operating costs to keep reports accurate."));
  bindSearch("expenses", () => openExpenseModal());
  view.querySelectorAll("[data-edit-expense]").forEach(button => button.addEventListener("click", () => {
    openExpenseModal(state.data.expenses.find(expense => expense.id === button.dataset.editExpense));
  }));
  view.querySelectorAll("[data-delete-expense]").forEach(button => button.addEventListener("click", async () => {
    if (!confirm("Delete this expense?")) return;
    await remove("expenses", button.dataset.deleteExpense);
    await loadData();
    render();
    showToast("Expense deleted");
  }));
}

function expenseTable(expenses, actions = true) {
  return table(["Date", "Category", "Vendor", "Amount", "Method", actions ? "" : "Notes"], expenses.map(expense => [
    esc(expense.date),
    esc(expense.category || "General"),
    `${esc(expense.vendor || "-")}<br><span class="muted">${esc(expense.notes || "")}</span>`,
    money(expense.amount),
    esc(expense.method || "Cash"),
    actions ? rowActions("expense", expense.id) : esc(expense.notes || "-")
  ]));
}

function expenseCategorySummary(fromDate = null) {
  const totals = new Map();
  for (const expense of state.data.expenses) {
    if (fromDate && expense.date < fromDate) continue;
    const category = expense.category || "General";
    totals.set(category, (totals.get(category) || 0) + num(expense.amount));
  }
  return [...totals.entries()]
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);
}

function renderInventory() {
  const products = state.data.products.filter(product => !isService(product));
  const moves = [...state.data.inventoryMoves].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 12);
  view.innerHTML = `
    <div class="toolbar">
      <input class="search" data-search="inventory" type="search" placeholder="Search stocked products" value="${esc(state.filters.inventory || "")}">
      <div class="toolbar-actions">
        <button class="primary" type="button" data-adjust-stock>Adjust stock</button>
      </div>
    </div>
    <div class="grid cols-2">
      <section class="table-card">
        <div class="card"><h2>Current stock</h2></div>
        ${products.length ? productTable(products.filter(product => includesText(product, state.filters.inventory || "")), false) : empty("No stocked products", "Create a product item to start tracking inventory.")}
      </section>
      <section class="table-card">
        <div class="card"><h2>Recent stock movement</h2></div>
        ${moves.length ? table(["Date", "Item", "Qty", "Reason"], moves.map(move => [
          esc(move.date),
          esc(productName(move.productId)),
          esc(move.qty),
          esc(move.reason || "-")
        ])) : empty("No stock movement", "Sales and manual adjustments will appear here.")}
      </section>
    </div>
  `;
  view.querySelector("[data-search='inventory']").addEventListener("input", event => {
    state.filters.inventory = event.target.value;
    render();
  });
  view.querySelector("[data-adjust-stock]").addEventListener("click", openStockModal);
}

function renderReports() {
  const monthStart = today().slice(0, 8) + "01";
  const receivables = state.data.invoices.reduce((sum, invoice) => sum + Math.max(0, invoiceTotal(invoice) - invoicePaid(invoice)), 0);
  const payables = state.data.purchases.reduce((sum, purchase) => sum + Math.max(0, purchaseTotal(purchase) - purchasePaid(purchase)), 0);
  const stockValue = state.data.products.reduce((sum, product) => sum + productStock(product) * num(product.cost), 0);
  const topItems = topProducts();
  view.innerHTML = `
    <div class="grid cols-4">
      ${metric("Total sales", money(salesTotal()), "All recorded invoices")}
      ${metric("Outstanding", money(receivables), `${overdueInvoices().length} overdue invoices`)}
      ${metric("Supplier payables", money(payables), "Unpaid purchase balances")}
      ${metric("Inventory value", money(stockValue), "Stock quantity × cost")}
    </div>
    <div class="grid cols-2" style="margin-top:16px">
      <section class="table-card">
        <div class="card"><h2>This month</h2></div>
        ${table(["Metric", "Amount"], [
          ["Sales", money(salesTotal(monthStart))],
          ["Payments", money(paidTotal(monthStart))],
          ["Purchases", money(purchaseTotalForPeriod(monthStart))],
          ["Supplier payments", money(purchasePaidTotal(monthStart))],
          ["Expenses", money(expenseTotal(monthStart))],
          ["Net cash", money(paidTotal(monthStart) - purchasePaidTotal(monthStart) - expenseTotal(monthStart))]
        ])}
      </section>
      <section class="table-card">
        <div class="card"><h2>Best sellers</h2></div>
        ${topItems.length ? table(["Item", "Qty", "Revenue"], topItems.map(item => [esc(item.name), esc(item.qty), money(item.revenue)])) : empty("No sales data", "Best sellers appear after invoices are created.")}
      </section>
    </div>
    <div class="grid cols-2" style="margin-top:16px">
      <section class="table-card">
        <div class="card"><h2>Overdue invoices</h2></div>
        ${overdueInvoices().length ? invoiceTable(overdueInvoices(), false) : empty("No overdue invoices", "Unpaid invoices past their due date will appear here.")}
      </section>
      <section class="table-card">
        <div class="card"><h2>Low stock</h2></div>
        ${lowStockProducts().length ? productTable(lowStockProducts(), false) : empty("No low-stock products", "Items at or below minimum stock will appear here.")}
      </section>
    </div>
    <div class="grid cols-2" style="margin-top:16px">
      <section class="table-card">
        <div class="card"><h2>Supplier balances</h2></div>
        ${supplierBalances().length ? table(["Supplier", "Balance"], supplierBalances().map(item => [esc(item.name), money(item.balance)])) : empty("No supplier balances", "Unpaid purchase balances will appear here.")}
      </section>
      <section class="table-card">
        <div class="card"><h2>Purchase history</h2></div>
        ${state.data.purchases.length ? purchaseTable([...state.data.purchases].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 8), false) : empty("No purchase history", "Recorded supplier purchases will appear here.")}
      </section>
    </div>
  `;
}

function renderSettings() {
  view.innerHTML = `
    <div class="grid cols-2">
      <section class="card">
        <h2>Backup and restore</h2>
        <p class="muted">Export all local app data as JSON, or import a previous backup into this browser.</p>
        <div class="toolbar-actions">
          <button id="settingsBackupBtn" class="secondary" type="button">Export JSON</button>
          <label class="primary file-action">
            Import JSON
            <input id="settingsRestoreInput" type="file" accept="application/json">
          </label>
        </div>
      </section>
      <section class="card">
        <h2>Offline app</h2>
        <p class="muted">Install this PWA to run it in its own app window. Data remains local to this browser profile.</p>
        <div class="toolbar-actions">
          <button id="settingsInstallBtn" class="secondary ${deferredInstallPrompt ? "" : "hidden"}" type="button">Install app</button>
        </div>
      </section>
    </div>
    <section class="card" style="margin-top:16px">
      <h2>Local data</h2>
      ${table(["Data type", "Records"], STORES.map(store => [esc(store), String(state.data[store].length)]))}
    </section>
  `;
  $("#settingsBackupBtn").addEventListener("click", exportJson);
  $("#settingsRestoreInput").addEventListener("change", importJson);
  $("#settingsInstallBtn")?.addEventListener("click", installApp);
}

function topProducts() {
  const map = new Map();
  for (const invoice of state.data.invoices) {
    for (const item of invoice.items || []) {
      const key = item.productId || item.description || "Custom item";
      const current = map.get(key) || { name: item.description || productName(item.productId), qty: 0, revenue: 0 };
      current.qty += num(item.qty);
      current.revenue += num(item.qty) * num(item.price);
      map.set(key, current);
    }
  }
  return [...map.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 8);
}

function table(headers, rows) {
  return `
    <div class="table-wrap">
      <table>
        <thead><tr>${headers.map(header => `<th>${esc(header)}</th>`).join("")}</tr></thead>
        <tbody>${rows.map(row => `<tr>${row.map((cell, index) => `<td data-label="${esc(headers[index])}" class="${index > 0 && /amount|total|paid|price|stock|minimum|qty/i.test(headers[index]) ? "amount" : ""}">${cell}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
    </div>
  `;
}

function rowActions(type, id) {
  return `
    <div class="inline-actions">
      ${actionButton("edit", `Edit ${type}`, `data-edit-${type}="${id}"`)}
      ${actionButton("delete", `Delete ${type}`, `data-delete-${type}="${id}"`, "danger")}
    </div>
  `;
}

function actionButton(icon, label, attrs, tone = "secondary") {
  const icons = {
    edit: "✎",
    delete: "⌫",
    pay: "$",
    receive: "✓"
  };
  return `<button class="${tone} icon-button table-action" type="button" ${attrs} aria-label="${esc(label)}" title="${esc(label)}">${icons[icon] || "•"}</button>`;
}

function openModal(title, body, onSubmit) {
  modalRoot.innerHTML = `
    <div class="modal-backdrop">
      <form class="modal">
        <header>
          <h2>${esc(title)}</h2>
          <button class="secondary icon-button" type="button" data-close-modal aria-label="Close">×</button>
        </header>
        <div class="form">${body}</div>
        <footer>
          <button class="secondary" type="button" data-close-modal>Cancel</button>
          <button class="primary" type="submit">Save</button>
        </footer>
      </form>
    </div>
  `;
  modalRoot.querySelectorAll("[data-close-modal]").forEach(button => button.addEventListener("click", closeModal));
  modalRoot.querySelector("form").addEventListener("submit", async event => {
    event.preventDefault();
    try {
      await onSubmit(new FormData(event.currentTarget));
      closeModal();
      await loadData();
      render();
    } catch (error) {
      showToast(error.message || "Please check the form and try again.");
    }
  });
}

function closeModal() {
  modalRoot.innerHTML = "";
}

function field(name, label, value = "", type = "text", attrs = "") {
  return `<div class="field"><label for="${name}">${esc(label)}</label><input id="${name}" name="${name}" type="${type}" value="${esc(value)}" ${attrs}></div>`;
}

function selectField(name, label, value, options) {
  return `<div class="field"><label for="${name}">${esc(label)}</label><select id="${name}" name="${name}">${options.map(option => `<option value="${esc(option)}" ${option === value ? "selected" : ""}>${esc(option)}</option>`).join("")}</select></div>`;
}

function textArea(name, label, value = "") {
  return `<div class="field full"><label for="${name}">${esc(label)}</label><textarea id="${name}" name="${name}">${esc(value)}</textarea></div>`;
}

function openCustomerModal(customer = {}) {
  openModal(customer.id ? "Edit customer" : "Add customer", `
    <div class="form-grid">
      ${field("name", "Customer name", customer.name || "", "text", "required")}
      ${field("phone", "Phone", customer.phone || "")}
      ${field("email", "Email", customer.email || "", "email")}
      ${field("address", "Address", customer.address || "")}
      ${textArea("notes", "Notes", customer.notes || "")}
    </div>
  `, async form => {
    await put("customers", {
      id: customer.id || uid("cus"),
      name: form.get("name").trim(),
      phone: form.get("phone").trim(),
      email: form.get("email").trim(),
      address: form.get("address").trim(),
      notes: form.get("notes").trim(),
      createdAt: customer.createdAt || new Date().toISOString()
    });
    showToast("Customer saved");
  });
}

function openSupplierModal(supplier = {}) {
  openModal(supplier.id ? "Edit supplier" : "Add supplier", `
    <div class="form-grid">
      ${field("name", "Supplier name", supplier.name || "", "text", "required")}
      ${field("phone", "Phone", supplier.phone || "")}
      ${field("email", "Email", supplier.email || "", "email")}
      ${field("address", "Address", supplier.address || "")}
      ${textArea("notes", "Notes", supplier.notes || "")}
    </div>
  `, async form => {
    await put("suppliers", {
      id: supplier.id || uid("sup"),
      name: form.get("name").trim(),
      phone: form.get("phone").trim(),
      email: form.get("email").trim(),
      address: form.get("address").trim(),
      notes: form.get("notes").trim(),
      createdAt: supplier.createdAt || new Date().toISOString()
    });
    showToast("Supplier saved");
  });
}

function openProductModal(product = {}) {
  const componentOptions = productOptionsHtml(product.id);
  const selectedType = product.id ? productTypeLabel(product) : "Product";
  openModal(product.id ? "Edit product/service" : "Add product/service", `
    <div class="form-grid">
      ${selectField("type", "Type", selectedType, ["Product", "Made Product", "Service"])}
      ${field("name", "Name", product.name || "", "text", "required")}
      ${field("sku", "SKU", product.sku || "")}
      ${field("category", "Category", product.category || "")}
      ${field("price", "Sale price", product.price || 0, "number", "min='0' step='0.01'")}
      ${field("cost", "Cost", product.cost || 0, "number", "min='0' step='0.01'")}
      ${field("stock", "Stock on hand", product.stock || 0, "number", "step='0.01'")}
      ${field("minStock", "Minimum stock", product.minStock || 0, "number", "min='0' step='0.01'")}
      ${textArea("notes", "Notes", product.notes || "")}
    </div>
    <div>
      <h3>Made from other products</h3>
      <div id="componentItems" class="line-items"></div>
      <button class="secondary" type="button" data-add-component ${componentOptions ? "" : "disabled"}>Add component</button>
    </div>
  `, async form => {
    const components = readProductComponents();
    const savedProduct = {
      id: product.id || uid("prd"),
      type: form.get("type"),
      name: form.get("name").trim(),
      sku: form.get("sku").trim(),
      category: form.get("category").trim(),
      price: num(form.get("price")),
      cost: num(form.get("cost")),
      stock: form.get("type") === "Service" || form.get("type") === "Made Product" ? 0 : num(form.get("stock")),
      minStock: form.get("type") === "Service" ? 0 : num(form.get("minStock")),
      components: form.get("type") === "Service" ? [] : components,
      notes: form.get("notes").trim(),
      createdAt: product.createdAt || new Date().toISOString()
    };
    await put("products", savedProduct);
    if (product.id) await backfillRecipeStock(product, savedProduct);
    showToast("Product/service saved");
  });
  const componentItems = modalRoot.querySelector("#componentItems");
  const addComponent = (component = {}) => {
    if (!componentOptions) return;
    const row = document.createElement("div");
    row.className = "line-item component-line-item";
    row.dataset.componentRow = "true";
    row.innerHTML = `
      <div class="field"><label>Component product</label><select data-component-product>${componentOptions}</select></div>
      <div class="field"><label>Qty used</label><input data-component-qty type="number" min="0" step="any" inputmode="decimal" value="${esc(component.qty || 1)}"></div>
      <button class="danger icon-button" type="button" aria-label="Remove component">×</button>
    `;
    row.querySelector("[data-component-product]").value = component.productId || row.querySelector("[data-component-product]").value;
    row.querySelector("button").addEventListener("click", () => row.remove());
    componentItems.appendChild(row);
  };
  modalRoot.querySelector("[data-add-component]")?.addEventListener("click", () => addComponent());
  (product.components || []).forEach(addComponent);
}

function readProductComponents() {
  return [...modalRoot.querySelectorAll("[data-component-row]")].map(row => ({
    productId: row.querySelector("[data-component-product]")?.value || "",
    qty: num(row.querySelector("[data-component-qty]")?.value)
  })).filter(component => component.productId && component.qty > 0);
}

async function backfillRecipeStock(oldProduct, newProduct) {
  const soldQty = state.data.invoices.reduce((sum, invoice) => {
    return sum + (invoice.items || [])
      .filter(item => item.productId === newProduct.id)
      .reduce((itemSum, item) => itemSum + num(item.qty), 0);
  }, 0);
  if (!soldQty) return;

  const oldComponents = componentMap(oldProduct.components || []);
  const newComponents = componentMap(newProduct.components || []);
  const componentIds = new Set([...oldComponents.keys(), ...newComponents.keys()]);

  const oldOwnTracked = oldProduct?.type !== "Service" && oldProduct?.type !== "Made Product";
  const newOwnTracked = !isService(newProduct) && !isMadeProduct(newProduct);
  const ownAdjustment = (oldOwnTracked ? soldQty : 0) - (newOwnTracked ? soldQty : 0);
  if (ownAdjustment) {
    await applyStockMove(newProduct, ownAdjustment, today(), `Type updated for ${newProduct.name}`);
  }

  for (const componentId of componentIds) {
    const componentProduct = state.data.products.find(record => record.id === componentId);
    if (!componentProduct || !isStockProduct(componentProduct)) continue;
    const oldUsed = soldQty * (oldComponents.get(componentId) || 0);
    const newUsed = soldQty * (newComponents.get(componentId) || 0);
    const adjustment = oldUsed - newUsed;
    if (!adjustment) continue;
    await applyStockMove(componentProduct, adjustment, today(), `Recipe updated for ${newProduct.name}`);
  }
  await updateInvoiceRecipeSnapshots(newProduct);
}

function componentMap(components) {
  const map = new Map();
  for (const component of components || []) {
    map.set(component.productId, (map.get(component.productId) || 0) + num(component.qty));
  }
  return map;
}

async function updateInvoiceRecipeSnapshots(product) {
  for (const invoice of state.data.invoices) {
    let changed = false;
    const items = (invoice.items || []).map(item => {
      if (item.productId !== product.id) return item;
      changed = true;
      return { ...item, components: cloneComponents(product.components || []) };
    });
    if (changed) await put("invoices", { ...invoice, items });
  }
}

function cloneComponents(components) {
  return (components || []).map(component => ({
    productId: component.productId,
    qty: num(component.qty)
  }));
}

function openExpenseModal(expense = {}) {
  openModal(expense.id ? "Edit expense" : "Add expense", `
    <div class="form-grid">
      ${field("date", "Date", expense.date || today(), "date", "required")}
      ${field("category", "Category", expense.category || "General", "text", "required")}
      ${field("vendor", "Vendor/payee", expense.vendor || "")}
      ${field("amount", "Amount", expense.amount || 0, "number", "min='0' step='0.01' required")}
      ${selectField("method", "Payment method", expense.method || "Cash", ["Cash", "Card", "Bank transfer", "Mobile wallet", "Other"])}
      ${textArea("notes", "Notes", expense.notes || "")}
    </div>
  `, async form => {
    await put("expenses", {
      id: expense.id || uid("exp"),
      date: form.get("date"),
      category: form.get("category").trim(),
      vendor: form.get("vendor").trim(),
      amount: num(form.get("amount")),
      method: form.get("method"),
      notes: form.get("notes").trim(),
      createdAt: expense.createdAt || new Date().toISOString()
    });
    showToast("Expense saved");
  });
}

function openInvoiceModal(invoice = {}) {
  const customerOptions = [`<option value="">Walk-in customer</option>`]
    .concat(state.data.customers.map(customer => `<option value="${customer.id}">${esc(customer.name)}</option>`)).join("");
  const productOptions = [`<option value="">Custom item</option>`]
    .concat(state.data.products.map(product => `<option value="${product.id}" data-price="${product.price}">${esc(product.name)} (${esc(productTypeLabel(product))}, ${esc(productStock(product))} available)</option>`)).join("");

  openModal(invoice.id ? "Edit invoice" : "New invoice", `
    <div class="form-grid">
      ${field("number", "Invoice number", invoice.number || nextInvoiceNumber(), "text", "required")}
      <div class="field"><label for="customerId">Customer</label><select id="customerId" name="customerId">${customerOptions}</select></div>
      ${field("date", "Invoice date", invoice.date || today(), "date", "required")}
      ${field("dueDate", "Due date", invoice.dueDate || addDays(14), "date")}
    </div>
    <div>
      <h3>Line items</h3>
      <div id="lineItems" class="line-items"></div>
      <button class="secondary" type="button" data-add-line>Add line</button>
    </div>
    <div class="form-grid">
      ${field("discount", "Invoice discount", invoice.discount || 0, "number", "min='0' step='0.01'")}
      ${field("customDeductionLabel", "Custom deduction label", invoice.customDeductionLabel || "", "text", "placeholder='Example: advance, adjustment, return'")}
      ${field("customDeduction", "Custom deduction amount", invoice.customDeduction || 0, "number", "min='0' step='0.01'")}
      ${field("paid", "Payment received", invoice.paid || 0, "number", "min='0' step='0.01'")}
      ${selectField("method", "Payment method", invoice.method || "Cash", ["Cash", "Card", "Bank transfer", "Mobile wallet", "Other"])}
      ${textArea("notes", "Notes", invoice.notes || "")}
    </div>
    <div class="summary-box">
      <div class="summary-row"><span>Subtotal after line discounts</span><strong id="invoiceSubtotal">${money(0)}</strong></div>
      <div class="summary-row"><span>Invoice deductions</span><strong id="invoiceDeductions">${money(0)}</strong></div>
      <div class="summary-row"><span>Invoice total</span><strong id="invoiceTotal">${money(0)}</strong></div>
      <div class="summary-row"><span>Balance due</span><strong id="invoiceBalance">${money(0)}</strong></div>
    </div>
  `, async form => {
    const items = [...modalRoot.querySelectorAll(".line-item")].map(row => {
      const productId = row.querySelector("[name='lineProduct']").value;
      const product = state.data.products.find(item => item.id === productId);
      return {
        productId,
        description: product?.name || row.querySelector("[name='lineDescription']").value.trim() || "Custom item",
        qty: num(row.querySelector("[name='lineQty']").value),
        price: num(row.querySelector("[name='linePrice']").value),
        discount: num(row.querySelector("[name='lineDiscount']").value),
        components: cloneComponents(product?.components || [])
      };
    }).filter(item => item.qty > 0 && item.price >= 0);
    if (!items.length) throw new Error("Invoice needs at least one line item.");
    const draft = {
      items,
      discount: num(form.get("discount")),
      customDeduction: num(form.get("customDeduction"))
    };
    const total = invoiceTotal(draft);
    const invoice = {
      id: form.get("id") || uid("inv"),
      number: form.get("number").trim(),
      customerId: form.get("customerId"),
      date: form.get("date"),
      dueDate: form.get("dueDate"),
      items,
      discount: num(form.get("discount")),
      customDeductionLabel: form.get("customDeductionLabel").trim(),
      customDeduction: num(form.get("customDeduction")),
      paid: Math.min(num(form.get("paid")), total),
      method: form.get("method"),
      notes: form.get("notes").trim(),
      paymentNotes: form.get("paymentNotes") || "",
      createdAt: form.get("createdAt") || new Date().toISOString()
    };
    if (form.get("id")) await applyInvoiceStock(state.data.invoices.find(item => item.id === form.get("id")), 1);
    await put("invoices", invoice);
    await applyInvoiceStock(invoice, -1);
    showToast(invoice.id === form.get("id") ? "Invoice updated and stock recalculated" : "Invoice saved and stock updated");
  });
  modalRoot.querySelector(".form").insertAdjacentHTML("beforeend", `
    <input type="hidden" name="id" value="${esc(invoice.id || "")}">
    <input type="hidden" name="createdAt" value="${esc(invoice.createdAt || "")}">
    <input type="hidden" name="paymentNotes" value="${esc(invoice.paymentNotes || "")}">
  `);
  modalRoot.querySelector("[name='customerId']").value = invoice.customerId || "";

  const lineItems = modalRoot.querySelector("#lineItems");
  const addLine = (line = {}) => {
    const productId = line.productId || "";
    const product = state.data.products.find(item => item.id === productId);
    const row = document.createElement("div");
    row.className = "line-item";
    row.innerHTML = `
      <div class="field"><label>Item</label><select name="lineProduct">${productOptions}</select><input name="lineDescription" type="text" placeholder="Custom description" value="${esc(line.description || "")}"></div>
      <div class="field"><label>Qty</label><input name="lineQty" type="number" min="0" step="0.01" value="${esc(line.qty || 1)}"></div>
      <div class="field"><label>Price</label><input name="linePrice" type="number" min="0" step="0.01" value="${esc(line.price ?? product?.price ?? 0)}"></div>
      <div class="field"><label>Discount</label><input name="lineDiscount" type="number" min="0" step="0.01" value="${esc(line.discount || 0)}"></div>
      <button class="danger icon-button" type="button" aria-label="Remove line">×</button>
    `;
    row.querySelector("[name='lineProduct']").value = productId;
    row.querySelector("[name='lineProduct']").addEventListener("change", event => {
      const selected = state.data.products.find(item => item.id === event.target.value);
      row.querySelector("[name='linePrice']").value = selected?.price || 0;
      row.querySelector("[name='lineDescription']").value = selected ? "" : row.querySelector("[name='lineDescription']").value;
      updateInvoiceSummary();
    });
    row.querySelectorAll("input, select").forEach(input => input.addEventListener("input", updateInvoiceSummary));
    row.querySelector("button").addEventListener("click", () => {
      row.remove();
      updateInvoiceSummary();
    });
    lineItems.appendChild(row);
    updateInvoiceSummary();
  };
  modalRoot.querySelector("[data-add-line]").addEventListener("click", () => addLine({ productId: state.data.products[0]?.id || "" }));
  modalRoot.querySelectorAll("[name='paid'], [name='discount'], [name='customDeduction']").forEach(input => input.addEventListener("input", updateInvoiceSummary));
  if (invoice.items?.length) invoice.items.forEach(addLine);
  else addLine({ productId: state.data.products[0]?.id || "" });
}

function openPurchaseModal(purchase = {}) {
  const stockedProducts = state.data.products.filter(isStockProduct);
  if (!stockedProducts.length) {
    showToast("Add a stocked product before recording a purchase");
    setPage("products");
    return;
  }
  const supplierOptions = [`<option value="">No supplier selected</option>`]
    .concat(state.data.suppliers.map(supplier => `<option value="${supplier.id}">${esc(supplier.name)}</option>`)).join("");
  const productOptions = stockedProducts
    .map(product => `<option value="${product.id}" data-cost="${product.cost}">${esc(product.name)} (${esc(productStock(product))} on hand)</option>`).join("");

  openModal(purchase.id ? "Edit supplier purchase" : "Record supplier purchase", `
    <div class="form-grid">
      ${field("number", "Bill / purchase number", purchase.number || nextPurchaseNumber(), "text", "required")}
      <div class="field"><label for="supplierId">Supplier</label><select id="supplierId" name="supplierId">${supplierOptions}</select></div>
      ${field("date", "Purchase date", purchase.date || today(), "date", "required")}
      ${field("dueDate", "Payment due date", purchase.dueDate || addDays(14), "date")}
      ${selectField("receiveStatus", "Order received", purchase.id ? purchaseReceiveStatus(purchase) : "Ordered", ["Ordered", "Received"])}
    </div>
    <div>
      <h3>Items bought</h3>
      <div id="purchaseItems" class="line-items"></div>
      <button class="secondary" type="button" data-add-purchase-line>Add item</button>
    </div>
    <div class="form-grid">
      ${field("paid", "Amount paid", purchase.paid || 0, "number", "min='0' step='0.01'")}
      ${selectField("method", "Payment method", purchase.method || "Cash", ["Cash", "Card", "Bank transfer", "Mobile wallet", "Other"])}
      ${textArea("notes", "Notes", purchase.notes || "")}
    </div>
    <div class="summary-box">
      <div class="summary-row"><span>Purchase total</span><strong id="purchaseTotal">${money(0)}</strong></div>
      <div class="summary-row"><span>Supplier balance</span><strong id="purchaseBalance">${money(0)}</strong></div>
    </div>
  `, async form => {
    const items = [...modalRoot.querySelectorAll(".purchase-line-item")].map(row => {
      const productId = row.querySelector("[name='purchaseProduct']").value;
      const product = state.data.products.find(item => item.id === productId);
      return {
        productId,
        description: product?.name || "Stock item",
        qty: num(row.querySelector("[name='purchaseQty']").value),
        cost: num(row.querySelector("[name='purchaseCost']").value)
      };
    }).filter(item => item.productId && item.qty > 0 && item.cost >= 0);
    if (!items.length) throw new Error("Purchase needs at least one stocked item.");
    const total = items.reduce((sum, item) => sum + item.qty * item.cost, 0);
    const purchase = {
      id: form.get("id") || uid("pur"),
      number: form.get("number").trim(),
      supplierId: form.get("supplierId"),
      date: form.get("date"),
      dueDate: form.get("dueDate"),
      items,
      paid: Math.min(num(form.get("paid")), total),
      method: form.get("method"),
      receiveStatus: form.get("receiveStatus"),
      receivedAt: form.get("receiveStatus") === "Received" ? (form.get("receivedAt") || new Date().toISOString()) : "",
      notes: form.get("notes").trim(),
      paymentNotes: form.get("paymentNotes") || "",
      createdAt: form.get("createdAt") || new Date().toISOString()
    };
    const oldPurchase = state.data.purchases.find(item => item.id === form.get("id"));
    if (form.get("id") && purchaseReceiveStatus(oldPurchase) === "Received") await applyPurchaseStock(oldPurchase, -1);
    await put("purchases", purchase);
    if (purchaseReceiveStatus(purchase) === "Received") await applyPurchaseStock(purchase, 1);
    showToast(purchaseReceiveStatus(purchase) === "Received" ? "Purchase saved and inventory updated" : "Purchase saved as ordered");
  });
  modalRoot.querySelector(".form").insertAdjacentHTML("beforeend", `
    <input type="hidden" name="id" value="${esc(purchase.id || "")}">
    <input type="hidden" name="createdAt" value="${esc(purchase.createdAt || "")}">
    <input type="hidden" name="paymentNotes" value="${esc(purchase.paymentNotes || "")}">
    <input type="hidden" name="receivedAt" value="${esc(purchase.receivedAt || "")}">
  `);
  modalRoot.querySelector("[name='supplierId']").value = purchase.supplierId || "";

  const purchaseItems = modalRoot.querySelector("#purchaseItems");
  const addLine = (line = {}) => {
    const productId = line.productId || stockedProducts[0]?.id || "";
    const product = state.data.products.find(item => item.id === productId);
    const row = document.createElement("div");
    row.className = "line-item purchase-line-item";
    row.innerHTML = `
      <div class="field"><label>Item</label><select name="purchaseProduct">${productOptions}</select></div>
      <div class="field"><label>Qty</label><input name="purchaseQty" type="number" min="0" step="0.01" value="${esc(line.qty || 1)}"></div>
      <div class="field"><label>Unit cost</label><input name="purchaseCost" type="number" min="0" step="0.01" value="${esc(line.cost ?? product?.cost ?? 0)}"></div>
      <button class="danger icon-button" type="button" aria-label="Remove item">×</button>
    `;
    row.querySelector("[name='purchaseProduct']").value = productId;
    row.querySelector("[name='purchaseProduct']").addEventListener("change", event => {
      const selected = state.data.products.find(item => item.id === event.target.value);
      row.querySelector("[name='purchaseCost']").value = selected?.cost || 0;
      updatePurchaseSummary();
    });
    row.querySelectorAll("input").forEach(input => input.addEventListener("input", updatePurchaseSummary));
    row.querySelector("button").addEventListener("click", () => {
      row.remove();
      updatePurchaseSummary();
    });
    purchaseItems.appendChild(row);
    updatePurchaseSummary();
  };
  modalRoot.querySelector("[data-add-purchase-line]").addEventListener("click", () => addLine());
  modalRoot.querySelector("[name='paid']").addEventListener("input", updatePurchaseSummary);
  if (purchase.items?.length) purchase.items.forEach(addLine);
  else addLine();
}

function updateInvoiceSummary() {
  const subtotal = [...modalRoot.querySelectorAll(".line-item")].reduce((sum, row) => {
    const gross = num(row.querySelector("[name='lineQty']").value) * num(row.querySelector("[name='linePrice']").value);
    return sum + Math.max(0, gross - num(row.querySelector("[name='lineDiscount']")?.value));
  }, 0);
  const deductions = num(modalRoot.querySelector("[name='discount']")?.value) + num(modalRoot.querySelector("[name='customDeduction']")?.value);
  const total = Math.max(0, subtotal - deductions);
  const paid = num(modalRoot.querySelector("[name='paid']")?.value);
  modalRoot.querySelector("#invoiceSubtotal").textContent = money(subtotal);
  modalRoot.querySelector("#invoiceDeductions").textContent = money(deductions);
  modalRoot.querySelector("#invoiceTotal").textContent = money(total);
  modalRoot.querySelector("#invoiceBalance").textContent = money(Math.max(0, total - paid));
}

function updatePurchaseSummary() {
  const total = [...modalRoot.querySelectorAll(".purchase-line-item")].reduce((sum, row) => {
    return sum + num(row.querySelector("[name='purchaseQty']").value) * num(row.querySelector("[name='purchaseCost']").value);
  }, 0);
  const paid = num(modalRoot.querySelector("[name='paid']")?.value);
  modalRoot.querySelector("#purchaseTotal").textContent = money(total);
  modalRoot.querySelector("#purchaseBalance").textContent = money(Math.max(0, total - paid));
}

function nextInvoiceNumber() {
  const number = state.data.invoices.length + 1;
  return `INV-${String(number).padStart(5, "0")}`;
}

function nextPurchaseNumber() {
  const number = state.data.purchases.length + 1;
  return `PUR-${String(number).padStart(5, "0")}`;
}

async function applyInvoiceStock(invoice, direction) {
  if (!invoice) return;
  for (const item of invoice.items || []) {
    const product = state.data.products.find(record => record.id === item.productId);
    if (!product || isService(product)) continue;
    const qty = num(item.qty) * direction;
    if (!isMadeProduct(product)) {
      await applyStockMove(product, qty, today(), `${direction < 0 ? "Sold on" : "Restored from"} ${invoice.number}`);
    }
    const components = item.components || product.components || [];
    for (const component of components) {
      const componentProduct = state.data.products.find(record => record.id === component.productId);
      if (!componentProduct || !isStockProduct(componentProduct)) continue;
      const componentQty = num(item.qty) * num(component.qty) * direction;
      await applyStockMove(componentProduct, componentQty, today(), `${direction < 0 ? "Used for" : "Restored from"} ${product.name} on ${invoice.number}`);
    }
  }
}

async function applyStockMove(product, qty, date, reason) {
  product.stock = num(product.stock) + qty;
  await put("products", product);
  await put("inventoryMoves", {
    id: uid("mov"),
    productId: product.id,
    qty,
    date,
    reason,
    createdAt: new Date().toISOString()
  });
}

async function applyPurchaseStock(purchase, direction) {
  if (!purchase) return;
  for (const item of purchase.items || []) {
    const product = state.data.products.find(record => record.id === item.productId);
    if (!product || !isStockProduct(product)) continue;
    const qty = num(item.qty) * direction;
    if (direction > 0) product.cost = num(item.cost);
    await applyStockMove(product, qty, purchase.date || today(), `${direction > 0 ? "Bought on" : "Removed from"} ${purchase.number}`);
  }
}

function openPaymentModal(invoiceId) {
  const invoice = state.data.invoices.find(item => item.id === invoiceId);
  if (!invoice) return;
  const balance = Math.max(0, invoiceTotal(invoice) - invoicePaid(invoice));
  openModal("Record payment", `
    <div class="form-grid">
      ${field("amount", "Payment amount", balance, "number", `min='0' max='${balance}' step='0.01' required`)}
      ${selectField("method", "Payment method", invoice.method || "Cash", ["Cash", "Card", "Bank transfer", "Mobile wallet", "Other"])}
      ${textArea("notes", "Payment note", "")}
    </div>
  `, async form => {
    invoice.paid = Math.min(invoiceTotal(invoice), invoicePaid(invoice) + num(form.get("amount")));
    invoice.method = form.get("method");
    invoice.paymentNotes = [invoice.paymentNotes, form.get("notes").trim()].filter(Boolean).join("\n");
    await put("invoices", invoice);
    showToast("Payment recorded");
  });
}

function openPurchasePaymentModal(purchaseId) {
  const purchase = state.data.purchases.find(item => item.id === purchaseId);
  if (!purchase) return;
  const balance = Math.max(0, purchaseTotal(purchase) - purchasePaid(purchase));
  openModal("Record supplier payment", `
    <div class="form-grid">
      ${field("amount", "Payment amount", balance, "number", `min='0' max='${balance}' step='0.01' required`)}
      ${selectField("method", "Payment method", purchase.method || "Cash", ["Cash", "Card", "Bank transfer", "Mobile wallet", "Other"])}
      ${textArea("notes", "Payment note", "")}
    </div>
  `, async form => {
    purchase.paid = Math.min(purchaseTotal(purchase), purchasePaid(purchase) + num(form.get("amount")));
    purchase.method = form.get("method");
    purchase.paymentNotes = [purchase.paymentNotes, form.get("notes").trim()].filter(Boolean).join("\n");
    await put("purchases", purchase);
    showToast("Supplier payment recorded");
  });
}

function openStockModal() {
  const products = state.data.products.filter(isStockProduct);
  if (!products.length) {
    showToast("Add a stocked product first");
    return;
  }
  const options = products.map(product => `<option value="${product.id}">${esc(product.name)} (${esc(productStock(product))} on hand)</option>`).join("");
  openModal("Adjust stock", `
    <div class="form-grid">
      <div class="field"><label for="productId">Product</label><select id="productId" name="productId">${options}</select></div>
      ${field("qty", "Quantity change", 0, "number", "step='0.01' required")}
      ${field("date", "Date", today(), "date", "required")}
      ${field("reason", "Reason", "Manual adjustment")}
    </div>
  `, async form => {
    const product = state.data.products.find(item => item.id === form.get("productId"));
    const qty = num(form.get("qty"));
    product.stock = num(product.stock) + qty;
    await put("products", product);
    await put("inventoryMoves", {
      id: uid("mov"),
      productId: product.id,
      qty,
      date: form.get("date"),
      reason: form.get("reason").trim(),
      createdAt: new Date().toISOString()
    });
    showToast("Stock adjusted");
  });
}

async function exportJson() {
  await loadData();
  const backup = {
    app: "LedgerLite Business",
    version: 1,
    exportedAt: new Date().toISOString(),
    data: state.data
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `ledgerlite-backup-${today()}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast("JSON backup exported");
}

async function importJson(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  const text = await file.text();
  const backup = JSON.parse(text);
  if (!backup.data || !["customers", "products", "invoices", "expenses", "inventoryMoves"].every(store => Array.isArray(backup.data[store]))) {
    alert("This JSON file is not a valid LedgerLite backup.");
    return;
  }
  if (!confirm("Import this backup? It will replace all current app data in this browser.")) return;
  for (const store of STORES) await clearStore(store);
  for (const store of STORES) {
    for (const record of backup.data[store] || []) await put(store, record);
  }
  await loadData();
  render();
  showToast("JSON backup imported");
}

function setupPwa() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js");
  }
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    $("#installBtn").classList.remove("hidden");
    $("#settingsInstallBtn")?.classList.remove("hidden");
  });
  $("#installBtn").addEventListener("click", installApp);
}

async function installApp() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  $("#installBtn").classList.add("hidden");
  $("#settingsInstallBtn")?.classList.add("hidden");
}

window.addEventListener("error", event => {
  showToast(event.message || "Something went wrong");
});

openDb().then(async database => {
  db = database;
  renderShell();
  setupPwa();
  await loadData();
  render();
}).catch(error => {
  view.innerHTML = empty("Storage is unavailable", error.message || "This browser blocked local database access.");
});
