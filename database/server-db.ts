import fs from 'fs';
import path from 'path';
import {
  GalleryItem, CategoryItem, CostumeItem, OrderItem, EventItem, TicketItem,
  UserItem, CouponItem, AuditLogItem, ReviewItem, SettingsItem, StockMovementItem
} from '@/lib/types';
import { SessionPayload } from '../security/session';
import {
  INITIAL_GALLERIES, INITIAL_CATEGORIES, INITIAL_COSTUMES, INITIAL_ORDERS,
  INITIAL_EVENTS, INITIAL_TICKETS, INITIAL_USERS, INITIAL_COUPONS,
  INITIAL_AUDIT_LOGS, INITIAL_SETTINGS, INITIAL_REVIEWS
} from './seed-data';

export interface ServerDBState {
  galleries: GalleryItem[];
  categories: CategoryItem[];
  costumes: CostumeItem[];
  orders: OrderItem[];
  events: EventItem[];
  tickets: TicketItem[];
  users: UserItem[];
  coupons: CouponItem[];
  auditLogs: AuditLogItem[];
  reviews: ReviewItem[];
  settings: SettingsItem;
  stockMovements?: StockMovementItem[];
}

export interface AnalyticsSummary {
  totalRevenue: number;
  revenueRental: number;
  revenueTickets: number;
  totalOrders: number;
  activeOrders: number;
  completedOrders: number;
  totalTicketsSold: number;
  gateCheckinCount: number;
  occupancyRate: number;
  totalCostumes: number;
  totalGalleries: number;
  topGalleries: GalleryItem[];
  recentActivities: AuditLogItem[];
}

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'sriwedari-db.json');
const UPLOADS_DIR = path.join(process.cwd(), 'public', 'uploads');

function ensureDirectories() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
}

function getInitialState(): ServerDBState {
  return {
    galleries: JSON.parse(JSON.stringify(INITIAL_GALLERIES)),
    categories: JSON.parse(JSON.stringify(INITIAL_CATEGORIES)),
    costumes: JSON.parse(JSON.stringify(INITIAL_COSTUMES)),
    orders: JSON.parse(JSON.stringify(INITIAL_ORDERS)),
    events: JSON.parse(JSON.stringify(INITIAL_EVENTS)),
    tickets: JSON.parse(JSON.stringify(INITIAL_TICKETS)),
    users: JSON.parse(JSON.stringify(INITIAL_USERS)),
    coupons: JSON.parse(JSON.stringify(INITIAL_COUPONS)),
    auditLogs: JSON.parse(JSON.stringify(INITIAL_AUDIT_LOGS)),
    reviews: JSON.parse(JSON.stringify(INITIAL_REVIEWS)),
    settings: JSON.parse(JSON.stringify(INITIAL_SETTINGS)),
    stockMovements: [],
  };
}

class ServerDatabaseService {
  private checkAndExpireOrders(db: ServerDBState): boolean {
    let changed = false;
    const now = Date.now();
    for (const order of db.orders || []) {
      if (order.status === 'Menunggu' && order.holdExpiresAt) {
        if (now > new Date(order.holdExpiresAt).getTime()) {
          order.status = 'Kedaluwarsa';
          order.cancelReason = 'Batas waktu penahanan (hold expiry) telah terlampaui';
          changed = true;

          // Restore costume stock
          const costume = db.costumes.find(c => c.id === order.costumeId);
          if (costume) {
            costume.stock += 1;
            if (!db.stockMovements) db.stockMovements = [];
            db.stockMovements.unshift({
              id: 'sm-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
              costumeId: costume.id,
              costumeName: costume.name,
              size: order.costumes?.[0]?.size || 'All Size',
              delta: 1,
              stockAfter: costume.stock,
              reason: 'koreksi',
              note: `Pelepasan stok otomatis: Pesanan sewa ${order.id} telah kedaluwarsa`,
              actorName: 'Sistem Kedaluwarsa Otomatis',
              orderId: order.id,
              createdAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
            });
          }
        }
      }
    }
    return changed;
  }

  private loadDB(): ServerDBState {
    ensureDirectories();
    try {
      if (!fs.existsSync(DB_FILE)) {
        const initial = getInitialState();
        fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf-8');
        return initial;
      }
      const raw = fs.readFileSync(DB_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      // Ensure all collections exist
      const state: ServerDBState = {
        ...getInitialState(),
        ...parsed,
      };

      if (this.checkAndExpireOrders(state)) {
        this.saveDB(state);
      }

      return state;
    } catch (err) {
      console.error('Error loading server DB, fallback to initial state', err);
      return getInitialState();
    }
  }

  private saveDB(data: ServerDBState): void {
    ensureDirectories();
    try {
      const tempFile = DB_FILE + '.tmp';
      fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf-8');
      fs.renameSync(tempFile, DB_FILE);
    } catch (err) {
      console.error('Error saving server DB', err);
    }
  }

  // ==========================================
  // GALLERIES
  // ==========================================
  getGalleries(): GalleryItem[] {
    return this.loadDB().galleries;
  }

  getGalleryById(id: string): GalleryItem | undefined {
    return this.getGalleries().find(g => g.id === id);
  }

  saveGallery(gallery: GalleryItem): GalleryItem {
    const db = this.loadDB();
    const idx = db.galleries.findIndex(g => g.id === gallery.id);
    if (idx >= 0) {
      db.galleries[idx] = gallery;
    } else {
      if (!gallery.id) {
        gallery.id = 'gal-' + Date.now();
      }
      db.galleries.unshift(gallery);
    }
    this.saveDB(db);
    this.logAudit('UPDATE_SETTINGS', `Karya galeri "${gallery.title}" disimpan`, 'info');
    return gallery;
  }

  deleteGallery(id: string): boolean {
    const db = this.loadDB();
    const prevLen = db.galleries.length;
    db.galleries = db.galleries.filter(g => g.id !== id);
    if (db.galleries.length !== prevLen) {
      this.saveDB(db);
      this.logAudit('UPDATE_SETTINGS', `Karya galeri ID ${id} dihapus`, 'warning');
      return true;
    }
    return false;
  }

  toggleLike(galleryId: string): { isLiked: boolean; likes: number } {
    const db = this.loadDB();
    const item = db.galleries.find(g => g.id === galleryId);
    if (!item) return { isLiked: false, likes: 0 };
    item.isLiked = !item.isLiked;
    item.likes = Math.max(0, (item.likes || 0) + (item.isLiked ? 1 : -1));
    this.saveDB(db);
    return { isLiked: !!item.isLiked, likes: item.likes };
  }

  // ==========================================
  // COSTUMES
  // ==========================================
  getCostumes(): CostumeItem[] {
    return this.loadDB().costumes;
  }

  getCostumeById(id: string): CostumeItem | undefined {
    return this.getCostumes().find(c => c.id === id);
  }

  saveCostume(costume: CostumeItem): CostumeItem {
    const db = this.loadDB();
    const idx = db.costumes.findIndex(c => c.id === costume.id);
    if (idx >= 0) {
      db.costumes[idx] = costume;
    } else {
      if (!costume.id) {
        costume.id = 'costume-' + Date.now();
      }
      db.costumes.unshift(costume);
    }
    this.saveDB(db);
    this.logAudit('UPDATE_SETTINGS', `Busana "${costume.name}" disimpan`, 'info');
    return costume;
  }

  deleteCostume(id: string): boolean {
    const db = this.loadDB();
    const prevLen = db.costumes.length;
    db.costumes = db.costumes.filter(c => c.id !== id);
    if (db.costumes.length !== prevLen) {
      this.saveDB(db);
      this.logAudit('UPDATE_SETTINGS', `Busana ID ${id} dihapus dari katalog`, 'warning');
      return true;
    }
    return false;
  }

  // ==========================================
  // CATEGORIES
  // ==========================================
  getCategories(): CategoryItem[] {
    return this.loadDB().categories;
  }

  saveCategory(category: CategoryItem): CategoryItem {
    const db = this.loadDB();
    const idx = db.categories.findIndex(c => c.id === category.id);
    if (idx >= 0) {
      db.categories[idx] = category;
    } else {
      if (!category.id) {
        category.id = 'cat-' + Date.now();
      }
      db.categories.push(category);
    }
    this.saveDB(db);
    return category;
  }

  deleteCategory(id: string): boolean {
    const db = this.loadDB();
    const prevLen = db.categories.length;
    db.categories = db.categories.filter(c => c.id !== id);
    if (db.categories.length !== prevLen) {
      this.saveDB(db);
      return true;
    }
    return false;
  }

  // ==========================================
  // ORDERS & QC
  // ==========================================
  getOrders(): OrderItem[] {
    return this.loadDB().orders;
  }

  getOrderById(id: string): OrderItem | undefined {
    return this.getOrders().find(o => o.id === id);
  }

  createOrder(order: Omit<OrderItem, 'id' | 'createdAt'>): OrderItem {
    const db = this.loadDB();
    const newId = 'ORD-' + new Date().getFullYear() + '-' + Math.floor(1000 + Math.random() * 9000);
    const holdMinutes = db.settings?.holdDurationMinutes || 1440;
    const holdExpiresAt = new Date(Date.now() + holdMinutes * 60 * 1000).toISOString();

    const newOrder: OrderItem = {
      ...order,
      id: newId,
      createdAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
      holdExpiresAt: order.holdExpiresAt || holdExpiresAt,
      refundStatus: 'tidak_ada',
    };
    db.orders.unshift(newOrder);

    // Decrement costume stock if available and record movement
    const costume = db.costumes.find(c => c.id === order.costumeId);
    if (costume && costume.stock > 0) {
      costume.stock -= 1;
      if (!db.stockMovements) db.stockMovements = [];
      db.stockMovements.unshift({
        id: 'sm-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
        costumeId: costume.id,
        costumeName: costume.name,
        size: order.costumes?.[0]?.size || 'All Size',
        delta: -1,
        stockAfter: costume.stock,
        reason: 'disewa',
        note: `Pesanan sewa baru ${newId}`,
        actorName: newOrder.userName,
        orderId: newId,
        createdAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
      });
    }

    this.saveDB(db);
    this.logAudit('CREATE_ORDER', `Pesanan sewa ${newId} senilai Rp ${newOrder.totalPrice.toLocaleString('id-ID')} dibuat oleh ${newOrder.userName}`, 'info', newOrder.userName, 'User');
    return newOrder;
  }

  updateOrderStatus(orderId: string, status: OrderItem['status']): OrderItem | null {
    const db = this.loadDB();
    const item = db.orders.find(o => o.id === orderId);
    if (!item) return null;
    const prev = item.status;
    item.status = status;

    // Return stock if cancelled or expired
    if (
      (status === 'Dibatalkan' || status === 'Kedaluwarsa') &&
      prev !== 'Dibatalkan' &&
      prev !== 'Kedaluwarsa'
    ) {
      const costume = db.costumes.find(c => c.id === item.costumeId);
      if (costume) {
        costume.stock += 1;
        if (!db.stockMovements) db.stockMovements = [];
        db.stockMovements.unshift({
          id: 'sm-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
          costumeId: costume.id,
          costumeName: costume.name,
          size: item.costumes?.[0]?.size || 'All Size',
          delta: 1,
          stockAfter: costume.stock,
          reason: 'koreksi',
          note: `Stok dikembalikan karena status pesanan: ${status}`,
          actorName: 'Admin/Sistem',
          orderId: item.id,
          createdAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
        });
      }
    }

    this.saveDB(db);
    this.logAudit('VERIFY_PAYMENT', `Pesanan ${orderId} diubah status: "${prev}" -> "${status}"`, 'info', 'Admin/Sistem', 'Admin');
    return item;
  }

  updateOrderQc(orderId: string, qcStatus: OrderItem['qcStatus'], refundAmount: number, note?: string): OrderItem | null {
    const db = this.loadDB();
    const item = db.orders.find(o => o.id === orderId);
    if (!item) return null;
    item.qcStatus = qcStatus;
    item.refundAmount = refundAmount;
    item.deductionNote = note;

    if (qcStatus && qcStatus !== 'Pending') {
      item.status = 'Selesai';
      item.completedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
      // Return costume stock
      const costume = db.costumes.find(c => c.id === item.costumeId);
      if (costume) {
        costume.stock += 1;
        if (!db.stockMovements) db.stockMovements = [];
        db.stockMovements.unshift({
          id: 'sm-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
          costumeId: costume.id,
          costumeName: costume.name,
          size: item.costumes?.[0]?.size || 'All Size',
          delta: 1,
          stockAfter: costume.stock,
          reason: 'dikembalikan',
          note: `Penyewa mengembalikan busana. Lulus QC: ${qcStatus}`,
          actorName: 'Kurator QC',
          orderId: item.id,
          createdAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
        });
      }
    }

    this.saveDB(db);
    this.logAudit('QC_RETURN', `Inspeksi QC untuk pesanan ${orderId}: ${qcStatus}, Refund Deposit Rp ${refundAmount.toLocaleString('id-ID')}. Catatan: ${note || '-'}`, 'info', 'Kurator QC', 'Admin');
    return item;
  }

  // ==========================================
  // STOCK MOVEMENTS
  // ==========================================
  getStockMovements(costumeId?: string): StockMovementItem[] {
    const all = this.loadDB().stockMovements || [];
    if (!costumeId) return all;
    return all.filter(sm => sm.costumeId === costumeId);
  }

  recordStockMovement(movement: Omit<StockMovementItem, 'id' | 'createdAt'>): StockMovementItem {
    const db = this.loadDB();
    if (!db.stockMovements) db.stockMovements = [];
    const newMovement: StockMovementItem = {
      ...movement,
      id: 'sm-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      createdAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
    };
    db.stockMovements.unshift(newMovement);
    this.saveDB(db);
    return newMovement;
  }

  attachPaymentProof(orderId: string, proofUrl: string): OrderItem | null {
    const db = this.loadDB();
    const item = db.orders.find(o => o.id === orderId);
    if (!item) return null;
    item.paymentProof = proofUrl;
    this.saveDB(db);
    this.logAudit('VERIFY_PAYMENT', `Slip transfer pembayaran diunggah untuk pesanan ${orderId}`, 'info', item.userName, 'User');
    return item;
  }

  // ==========================================
  // EVENTS & PENTAS
  // ==========================================
  getEvents(): EventItem[] {
    return this.loadDB().events;
  }

  getEventById(id: string): EventItem | undefined {
    return this.getEvents().find(e => e.id === id);
  }

  saveEvent(event: EventItem): EventItem {
    const db = this.loadDB();
    const idx = db.events.findIndex(e => e.id === event.id);
    if (idx >= 0) {
      db.events[idx] = event;
    } else {
      if (!event.id) {
        event.id = 'evt-' + Date.now();
      }
      db.events.unshift(event);
    }
    this.saveDB(db);
    this.logAudit('UPDATE_SETTINGS', `Jadwal pementasan "${event.title}" disimpan`, 'info', 'Kurator', 'Admin');
    return event;
  }

  deleteEvent(id: string): boolean {
    const db = this.loadDB();
    const prevLen = db.events.length;
    db.events = db.events.filter(e => e.id !== id);
    if (db.events.length !== prevLen) {
      this.saveDB(db);
      this.logAudit('UPDATE_SETTINGS', `Jadwal pementasan ID ${id} dihapus`, 'warning', 'Kurator', 'Admin');
      return true;
    }
    return false;
  }

  // ==========================================
  // TICKETS & GATE CHECKIN
  // ==========================================
  getTickets(): TicketItem[] {
    return this.loadDB().tickets;
  }

  getTicketById(id: string): TicketItem | undefined {
    return this.getTickets().find(t => t.id === id);
  }

  getBookedSeats(eventId: string): string[] {
    const tickets = this.getTickets().filter(t => t.eventId === eventId && t.status !== 'Kedaluwarsa');
    const seats: string[] = [];
    tickets.forEach(t => {
      if (t.seats && Array.isArray(t.seats)) {
        seats.push(...t.seats);
      }
    });
    return seats;
  }

  bookTicketAtomic(ticket: Omit<TicketItem, 'id' | 'bookingCode' | 'createdAt'>): { success: boolean; ticket?: TicketItem; error?: string } {
    const db = this.loadDB();

    // 1. Collision Check (Anti-Double Booking)
    const existingBooked = new Set<string>();
    db.tickets
      .filter(t => t.eventId === ticket.eventId && t.status !== 'Kedaluwarsa')
      .forEach(t => {
        if (t.seats && Array.isArray(t.seats)) {
          t.seats.forEach(s => existingBooked.add(s));
        }
      });

    const conflicts = (ticket.seats || []).filter(s => existingBooked.has(s));
    if (conflicts.length > 0) {
      return {
        success: false,
        error: `Kursi [${conflicts.join(', ')}] telah dipesan oleh penonton lain! Silakan pilih kursi lain.`,
      };
    }

    // 2. Generate Ticket
    const newId = 'TCK-' + new Date().getFullYear() + '-' + Math.floor(100 + Math.random() * 900);
    const bookingCode = 'SWD-' + Math.random().toString(36).substring(2, 7).toUpperCase();
    const newTicket: TicketItem = {
      ...ticket,
      id: newId,
      bookingCode,
      createdAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
    };

    db.tickets.unshift(newTicket);

    // Update booked count on event
    const evt = db.events.find(e => e.id === ticket.eventId);
    if (evt) {
      evt.booked = Math.min(evt.quota, (evt.booked || 0) + ticket.quantity);
    }

    this.saveDB(db);
    this.logAudit('BOOK_TICKET', `Reservasi tiket ${newTicket.bookingCode} (${ticket.quantity} kursi: ${newTicket.seats.join(', ')}) di acara "${ticket.eventTitle}"`, 'info', ticket.userName, 'User');
    return { success: true, ticket: newTicket };
  }

  validateGateTicket(codeOrId: string): { success: boolean; message: string; ticket?: TicketItem } {
    const db = this.loadDB();
    const clean = codeOrId.trim().toUpperCase();
    const ticket = db.tickets.find(
      t => t.bookingCode.toUpperCase() === clean || t.id.toUpperCase() === clean
    );

    if (!ticket) {
      return { success: false, message: 'Tiket tidak ditemukan di sistem loket Sriwedari!' };
    }
    if (ticket.status === 'Check-in') {
      return { success: false, message: `Tiket ${ticket.bookingCode} sudah pernah digunakan check-in!`, ticket };
    }
    if (ticket.status === 'Kedaluwarsa') {
      return { success: false, message: `Tiket ${ticket.bookingCode} telah kedaluwarsa!`, ticket };
    }

    ticket.status = 'Check-in';
    this.saveDB(db);
    this.logAudit('GATE_CHECKIN', `Gate scanner mengonfirmasi masuk tiket ${ticket.bookingCode} (${ticket.userName}, Kursi: ${ticket.seats.join(', ')})`, 'info', 'Gate Loket Scanner', 'Admin');
    return { success: true, message: `Check-in Berhasil! Silakan masuk pintu pementasan.`, ticket };
  }

  // ==========================================
  // USERS
  // ==========================================
  getUsers(): UserItem[] {
    return this.loadDB().users;
  }

  getUserById(id: string): UserItem | undefined {
    return this.getUsers().find(u => u.id === id);
  }

  getUserByEmail(email: string): UserItem | undefined {
    return this.getUsers().find(u => u.email.toLowerCase() === email.trim().toLowerCase());
  }

  saveUser(user: UserItem): UserItem {
    const db = this.loadDB();
    const idx = db.users.findIndex(u => u.id === user.id);
    if (idx >= 0) {
      db.users[idx] = { ...db.users[idx], ...user };
    } else {
      if (!user.id) {
        user.id = 'usr-' + Date.now();
      }
      db.users.push(user);
    }
    this.saveDB(db);
    return user;
  }

  deleteUser(id: string): boolean {
    const db = this.loadDB();
    const prevLen = db.users.length;
    db.users = db.users.filter(u => u.id !== id);
    if (db.users.length !== prevLen) {
      this.saveDB(db);
      this.logAudit('DELETE_USER', `Pengguna ID ${id} dihapus dari sistem`, 'warning', 'Administrator', 'Admin');
      return true;
    }
    return false;
  }

  // ==========================================
  // COUPONS
  // ==========================================
  getCoupons(): CouponItem[] {
    return this.loadDB().coupons;
  }

  saveCoupon(coupon: CouponItem): CouponItem {
    const db = this.loadDB();
    const idx = db.coupons.findIndex(c => c.id === coupon.id);
    if (idx >= 0) {
      db.coupons[idx] = coupon;
    } else {
      if (!coupon.id) {
        coupon.id = 'coup-' + Date.now();
      }
      db.coupons.push(coupon);
    }
    this.saveDB(db);
    return coupon;
  }

  deleteCoupon(id: string): boolean {
    const db = this.loadDB();
    const prevLen = db.coupons.length;
    db.coupons = db.coupons.filter(c => c.id !== id);
    if (db.coupons.length !== prevLen) {
      this.saveDB(db);
      return true;
    }
    return false;
  }

  validateCoupon(code: string, totalAmount: number): { valid: boolean; discount: number; message: string; coupon?: CouponItem } {
    const coupons = this.getCoupons();
    const match = coupons.find(c => c.code.toUpperCase() === code.trim().toUpperCase() && c.isActive);
    if (!match) {
      return { valid: false, discount: 0, message: 'Kode kupon tidak valid atau sudah tidak aktif!' };
    }
    if (totalAmount < match.minOrder) {
      return {
        valid: false,
        discount: 0,
        message: `Minimal transaksi untuk kupon ini adalah Rp ${match.minOrder.toLocaleString('id-ID')}`
      };
    }
    let discount = 0;
    if (match.type === 'PERCENTAGE') {
      discount = Math.round((totalAmount * match.value) / 100);
    } else {
      discount = match.value;
    }
    return { valid: true, discount, message: `Kupon ${match.code} berhasil diterapkan! Diskon: Rp ${discount.toLocaleString('id-ID')}`, coupon: match };
  }

  // ==========================================
  // SETTINGS & RESET
  // ==========================================
  getSettings(): SettingsItem {
    return this.loadDB().settings;
  }

  saveSettings(settings: SettingsItem): SettingsItem {
    const db = this.loadDB();
    db.settings = settings;
    this.saveDB(db);
    this.logAudit('UPDATE_SETTINGS', 'Pengaturan operasional sanggar Sriwedari diperbarui', 'info', 'Administrator', 'Admin');
    return settings;
  }

  resetDB(): ServerDBState {
    const initial = getInitialState();
    this.saveDB(initial);
    this.logAudit('RESET_DB', 'Sistem mengembalikan seluruh basis data ke kondisi awal pementasan', 'warning', 'Administrator', 'Admin');
    return initial;
  }

  // ==========================================
  // REVIEWS
  // ==========================================
  getReviews(targetId?: string): ReviewItem[] {
    const all = this.loadDB().reviews || [];
    if (!targetId) return all;
    return all.filter(r => r.targetId === targetId);
  }

  addReview(review: Omit<ReviewItem, 'id' | 'createdAt'>): ReviewItem {
    const db = this.loadDB();
    if (!db.reviews) db.reviews = [];
    const newId = 'rev-' + Date.now();
    const newReview: ReviewItem = {
      ...review,
      id: newId,
      status: review.status || 'tampil',
      createdAt: new Date().toISOString().replace('T', ' ').slice(0, 10),
    };
    db.reviews.unshift(newReview);
    this.saveDB(db);
    return newReview;
  }

  updateReviewStatus(id: string, status: 'tampil' | 'disembunyikan'): ReviewItem | null {
    const db = this.loadDB();
    if (!db.reviews) return null;
    const item = db.reviews.find(r => r.id === id);
    if (!item) return null;
    item.status = status;
    this.saveDB(db);
    this.logAudit('UPDATE_SETTINGS', `Moderasi ulasan ${id} diubah menjadi "${status}"`, 'info', 'Admin', 'Admin');
    return item;
  }

  deleteReview(id: string): boolean {
    const db = this.loadDB();
    if (!db.reviews) return false;
    const prev = db.reviews.length;
    db.reviews = db.reviews.filter(r => r.id !== id);
    if (db.reviews.length !== prev) {
      this.saveDB(db);
      this.logAudit('UPDATE_SETTINGS', `Ulasan ID ${id} dihapus dari sistem`, 'warning', 'Admin', 'Admin');
      return true;
    }
    return false;
  }

  // ==========================================
  // AUDIT LOGS
  // ==========================================
  getAuditLogs(): AuditLogItem[] {
    return this.loadDB().auditLogs;
  }

  logAudit(
    action: AuditLogItem['action'],
    details: string,
    severity: AuditLogItem['severity'] = 'info',
    actorName = 'Sistem',
    actorRole = 'Sistem'
  ): void {
    const db = this.loadDB();
    const newLog: AuditLogItem = {
      id: 'aud-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
      timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
      action,
      actorName,
      actorRole,
      details,
      ipAddress: '127.0.0.1 (Localhost)',
      severity,
    };
    db.auditLogs.unshift(newLog);
    // Keep max 200 logs
    if (db.auditLogs.length > 200) {
      db.auditLogs = db.auditLogs.slice(0, 200);
    }
    this.saveDB(db);
  }

  exportAuditLogsCsv(): string {
    const logs = this.getAuditLogs();
    const headers = ['ID', 'Waktu', 'Aksi', 'Aktor', 'Peran', 'Rincian', 'IP', 'Tingkat Keparahan'];
    const rows = logs.map(l => [
      l.id,
      `"${l.timestamp}"`,
      `"${l.action}"`,
      `"${l.actorName.replace(/"/g, '""')}"`,
      `"${l.actorRole}"`,
      `"${l.details.replace(/"/g, '""')}"`,
      `"${l.ipAddress}"`,
      `"${l.severity}"`
    ]);
    return '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  }

  // ==========================================
  // REAL ANALYTICAL ENGINE
  // ==========================================
  getAnalytics(): AnalyticsSummary {
    const db = this.loadDB();

    // 1. Revenue from Orders (Confirmed or Selesai)
    const validOrders = db.orders.filter(o => o.status === 'Dikonfirmasi' || o.status === 'Sedang Disewa' || o.status === 'Selesai');
    const revenueRental = validOrders.reduce((sum, o) => sum + (o.totalPrice || 0), 0);

    // 2. Revenue from Tickets (Active or Check-in)
    const validTickets = db.tickets.filter(t => t.status === 'Aktif' || t.status === 'Check-in');
    const revenueTickets = validTickets.reduce((sum, t) => sum + (t.totalPrice || 0), 0);

    const totalRevenue = revenueRental + revenueTickets;

    // 3. Order statuses
    const activeOrders = db.orders.filter(o => o.status === 'Menunggu' || o.status === 'Dikonfirmasi' || o.status === 'Sedang Disewa').length;
    const completedOrders = db.orders.filter(o => o.status === 'Selesai').length;

    // 4. Ticket metrics
    const totalTicketsSold = validTickets.reduce((sum, t) => sum + (t.quantity || 1), 0);
    const gateCheckinCount = db.tickets.filter(t => t.status === 'Check-in').length;

    // 5. Occupancy rate
    const totalEventQuota = db.events.reduce((sum, e) => sum + (e.quota || 0), 0);
    const totalEventBooked = db.events.reduce((sum, e) => sum + (e.booked || 0), 0);
    const occupancyRate = totalEventQuota > 0 ? Math.round((totalEventBooked / totalEventQuota) * 100) : 0;

    // 6. Top galleries
    const topGalleries = [...db.galleries]
      .sort((a, b) => (b.views + (b.likes * 10)) - (a.views + (a.likes * 10)))
      .slice(0, 5);

    return {
      totalRevenue,
      revenueRental,
      revenueTickets,
      totalOrders: db.orders.length,
      activeOrders,
      completedOrders,
      totalTicketsSold,
      gateCheckinCount,
      occupancyRate,
      totalCostumes: db.costumes.length,
      totalGalleries: db.galleries.length,
      topGalleries,
      recentActivities: db.auditLogs.slice(0, 10),
    };
  }

  // ==========================================
  // FULL DUMP & SYNC (SANITIZED)
  // ==========================================
  getFullState(): ServerDBState {
    const db = this.loadDB();
    // NEVER expose passwords under any circumstance
    const sanitizedUsers = (db.users || []).map(u => {
      const copy = { ...u };
      delete copy.password;
      return copy;
    });
    return {
      ...db,
      users: sanitizedUsers,
    };
  }

  getSanitizedStateForUser(session?: SessionPayload | null): ServerDBState {
    const db = this.loadDB();

    // 1. If Admin: return full state with sanitized users
    if (session && session.role === 'admin') {
      return this.getFullState();
    }

    // 2. If Registered User: only return public collections + their own orders & tickets
    if (session && session.role === 'user') {
      const userOrders = (db.orders || []).filter(
        o => o.userEmail?.toLowerCase() === session.email.toLowerCase() || o.userName === session.name
      );
      const userTickets = (db.tickets || []).filter(
        t => t.userName === session.name
      );
      return {
        galleries: db.galleries || [],
        categories: db.categories || [],
        costumes: db.costumes || [],
        events: db.events || [],
        reviews: (db.reviews || []).filter(r => r.status !== 'disembunyikan'),
        settings: db.settings,
        orders: userOrders,
        tickets: userTickets,
        coupons: [], // Coupons only revealed/validated on checkout
        users: [],   // No other users revealed
        auditLogs: [], // Audit logs strictly admin-only
        stockMovements: [],
      };
    }

    // 3. Guest / Anonymous Visitor: strictly public data only
    return {
      galleries: db.galleries || [],
      categories: db.categories || [],
      costumes: db.costumes || [],
      events: db.events || [],
      reviews: (db.reviews || []).filter(r => r.status !== 'disembunyikan'),
      settings: db.settings,
      orders: [],
      tickets: [],
      coupons: [],
      users: [],
      auditLogs: [],
      stockMovements: [],
    };
  }
}

export const ServerDB = new ServerDatabaseService();
