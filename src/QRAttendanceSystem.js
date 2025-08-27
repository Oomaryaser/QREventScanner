"use client";
import React, { useState, useEffect } from 'react';
import { QrCode, Users, CheckCircle, RotateCcw, Settings, Download, PlusCircle, Clock, Camera } from 'lucide-react';
import { supabase } from './supabaseClient';
// مفتاح آخر رمز مستخدم
const LAST_USER_KEY = 'qr_last_user_code';

// ===== helpers: QR =====
const generateQRCode = async (data, size = 200) => {
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(data)}&format=png`;
  try {
    const response = await fetch(qrUrl);
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error('خطأ في توليد QR Code:', error);
    return null;
  }
};

// ربط الـ QR بالمستخدم فقط + تضمين رقم الهاتف + الاسم (بدون وقت حدث داخلي)
const generateQRData = (userCode, groupId, guestCount, phone, displayNameEnc) => {
  return `USER:${userCode}|GUEST:${groupId}|COUNT:${guestCount}|PHONE:${phone}|NAME:${displayNameEnc}|TIME:${Date.now()}`;
};

// ===== Parsing بسيط لسلسلة QR =====
const parseQRData = (str) => {
  const parts = (str || '').split('|');
  const obj = {};
  for (const p of parts) {
    const [k, ...rest] = p.split(':');
    obj[k] = rest.join(':'); // يدعم وجود : في القيم
  }
  return obj; // {USER, GUEST, COUNT, PHONE, NAME, TIME}
};

const fmtDateTimeLocal = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const fromDateTimeLocalToISO = (value) => {
  if (!value) return null;
  const d = new Date(value);
  const iso = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString(); // حفظ UTC
  return iso;
};

const QRAttendanceSystem = () => {
  const [route, setRoute] = useState('app'); // 'app' | 'invite'
  const [currentView, setCurrentView] = useState('login');
  const [userData, setUserData] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const [storeData, setStoreData] = useState({
    eventTimeISO: null, // وقت الفعالية بصيغة ISO (Global)
    totalGuests: 0,
    attendedGuests: 0,
    guestsList: [],
  });

  const [scanResult, setScanResult] = useState('');
  const [showAppendPanel, setShowAppendPanel] = useState(false);
  // ===== Routing بدائي: /invite => InviteView
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const path = window.location.pathname || '/';
    if (path.startsWith('/invite')) setRoute('invite');
    else setRoute('app');
  }, []);

  // ===== مصادقة مبسطة =====
  const authenticateUser = async (_userCode) => {
    try {
      setIsAuthenticated(true);
      return true;
    } catch (error) {
      console.error('خطأ في المصادقة:', error);
      return false;
    }
  };

  // ===== تخزين محلي كـ fallback =====
  const localKey = (userCode) => `qr_user_${userCode}`;

  const saveLocal = (userCode, data) => {
    try {
      localStorage.setItem(localKey(userCode), JSON.stringify({ ...data, ts: Date.now() }));
      localStorage.setItem(LAST_USER_KEY, userCode);
    } catch (e) {
      console.error('خطأ حفظ محلي:', e);
    }
  };

  const loadLocal = (userCode) => {
    try {
      const s = localStorage.getItem(localKey(userCode));
      if (!s) return null;
      const parsed = JSON.parse(s);
      parsed.guestsList = (parsed.guestsList || []).map(g => ({ ...g, phone: g.phone || '', isEditing: false, editName: '' }));
      return parsed;
    } catch (e) {
      console.error('خطأ جلب محلي:', e);
      return null;
    }
  };

  const clearLocal = (userCode) => {
    try {
      localStorage.removeItem(localKey(userCode));
    } catch (_) {}
  };

  // ===== Supabase: جدول أساسي + fallback =====
  const supabaseUpsert = async (userCode, data) => {
    try {
      const { error } = await supabase
        .from('user_qr_codes')
        .upsert({
          email: userCode,
          event_time: data.eventTimeISO, // وقت الفعالية العام
          total_guests: data.totalGuests,
          attended_guests: data.attendedGuests,
          guests: data.guestsList.map(g => ({
            id: g.id,
            name: g.name,
            phone: g.phone,
            attended: g.attended,
            maxGuests: g.maxGuests,
            qrCode: g.qrCode,
            qrImageUrl: g.qrImageUrl,
            inviteUrl: g.inviteUrl
          })),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'email' });
      if (!error) return true;
      console.warn('upsert user_qr_codes error, fallback to event_history:', error?.message);
    } catch (e) {
      console.warn('user_qr_codes not available, fallback:', e?.message);
    }

    try {
      const { error } = await supabase
        .from('event_history')
        .upsert({
          email: userCode,
          event_name: null,
          event_id: null,
          event_time: data.eventTimeISO,
          total_guests: data.totalGuests,
          attended_guests: data.attendedGuests,
          guests: data.guestsList.map(g => ({
            id: g.id,
            name: g.name,
            phone: g.phone,
            attended: g.attended,
            maxGuests: g.maxGuests,
            qrCode: g.qrCode,
            qrImageUrl: g.qrImageUrl,
            inviteUrl: g.inviteUrl
          })),
          ended_at: new Date().toISOString()
        }, { onConflict: 'email' });
      if (!error) return true;
      console.error('upsert event_history error:', error?.message);
    } catch (e) {
      console.error('fallback upsert failed:', e?.message);
    }
    return false;
  };

  const supabaseLoad = async (userCode) => {
    try {
      const { data, error } = await supabase
        .from('user_qr_codes')
        .select('*')
        .eq('email', userCode)
        .limit(1)
        .single();

      if (!error && data) {
        const guests = (data.guests || []).map(g => ({ ...g, phone: g.phone || '', isEditing: false, editName: '' }));
        return {
          eventTimeISO: data.event_time || null,
          totalGuests: data.total_guests || guests.reduce((s, gg) => s + (gg.maxGuests || 0), 0),
          attendedGuests: data.attended_guests || guests.reduce((s, gg) => s + (gg.attended || 0), 0),
          guestsList: guests
        };
      }
    } catch (_) { /* تجاهل */ }

    try {
      const { data, error } = await supabase
        .from('event_history')
        .select('*')
        .eq('email', userCode)
        .order('ended_at', { ascending: false })
        .limit(1)
        .single();

      if (!error && data) {
        const guests = (data.guests || []).map(g => ({ ...g, phone: g.phone || '', isEditing: false, editName: '' }));
        return {
          eventTimeISO: data.event_time || null,
          totalGuests: data.total_guests || guests.reduce((s, gg) => s + (gg.maxGuests || 0), 0),
          attendedGuests: data.attended_guests || guests.reduce((s, gg) => s + (gg.attended || 0), 0),
          guestsList: guests
        };
      }
    } catch (_) { /* تجاهل */ }

    return null;
  };

  const supabaseDeleteAll = async (userCode) => {
    let ok = true;
    try {
      const { error } = await supabase.from('user_qr_codes').delete().eq('email', userCode);
      if (error) {
        console.warn('delete user_qr_codes error (may be absent):', error.message);
      }
    } catch (e) {}
    try {
      const { error } = await supabase.from('event_history').delete().eq('email', userCode);
      if (error) {
        console.warn('delete event_history error (fallback):', error.message);
      }
    } catch (e) {
      ok = false;
      console.error('delete fallback failed:', e?.message);
    }
    return ok;
  };

  // ===== حفظ تلقائي =====
  useEffect(() => {
    const persist = async () => {
      if (!userData?.userCode) return;
      if (
        storeData.guestsList.length === 0 &&
        storeData.attendedGuests === 0 &&
        storeData.totalGuests === 0 &&
        !storeData.eventTimeISO
      ) {
        return;
      }
      const ok = await supabaseUpsert(userData.userCode, storeData);
      if (!ok) saveLocal(userData.userCode, storeData);
    };
    persist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeData]);

  // ===== دخول تلقائي على آخر مستخدم =====
  useEffect(() => {
    if (route !== 'app') return;
    const init = async () => {
      try {
        setIsAuthenticated(true);
        const lastCode = typeof window !== 'undefined' ? localStorage.getItem(LAST_USER_KEY) : null;
        if (lastCode) {
          const fromDb = await supabaseLoad(lastCode);
          if (fromDb) {
            setUserData({ userCode: lastCode, createdAt: new Date().toISOString() });
            setStoreData(fromDb);
            setCurrentView('organizer');
            return;
          }
          const fromLocal = loadLocal(lastCode);
          if (fromLocal) {
            setUserData({ userCode: lastCode, createdAt: new Date().toISOString() });
            setStoreData({
              eventTimeISO: fromLocal.eventTimeISO || null,
              totalGuests: fromLocal.totalGuests || 0,
              attendedGuests: fromLocal.attendedGuests || 0,
              guestsList: fromLocal.guestsList || [],
            });
            setCurrentView('organizer');
            return;
          }
          setUserData({ userCode: lastCode, createdAt: new Date().toISOString() });
          setStoreData({ eventTimeISO: null, totalGuests: 0, attendedGuests: 0, guestsList: [] });
          setCurrentView('organizer');
          return;
        }
        setCurrentView('login');
      } catch (err) {
        console.error('init error:', err);
        setCurrentView('login');
      }
    };
    init();
  }, [route]);

  // ===== شاشة تسجيل الدخول =====
  const LoginForm = () => {
    const [userCode, setUserCode] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleLogin = async (e) => {
      e.preventDefault();
      if (!userCode.trim()) {
        setError('يرجى إدخال رمز المستخدم');
        return;
      }
      setIsLoading(true);
      setError('');

      try {
        const authSuccess = await authenticateUser(userCode);
        if (!authSuccess) {
          setError('فشل في المصادقة. سيتم استخدام التخزين المحلي.');
        }

        const fromDb = await supabaseLoad(userCode);
        const fromLocal = !fromDb ? loadLocal(userCode) : null;

        setUserData({ userCode, createdAt: new Date().toISOString() });
        setStoreData(fromDb || fromLocal || { eventTimeISO: null, totalGuests: 0, attendedGuests: 0, guestsList: [] });
        localStorage.setItem(LAST_USER_KEY, userCode);
        setCurrentView('organizer');
      } catch (error) {
        setError('حدث خطأ أثناء تسجيل الدخول');
        console.error('login error:', error);
      }
      setIsLoading(false);
    };

    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50" dir="rtl">
        <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
          <div className="text-center mb-6">
            <QrCode className="w-16 h-16 mx-auto text-blue-600 mb-4" />
            <h1 className="text-2xl font-bold text-gray-800">نظام حضور QR</h1>
            <p className="text-gray-600 mt-2">أدخل رمز المستخدم الخاص بك</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            {error && <div className="bg-red-50 border border-red-200 text-red-800 p-3 rounded-md text-sm">{error}</div>}
            {!isAuthenticated && (
              <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 p-3 rounded-md text-sm">
                ملاحظة: سيتم استخدام التخزين المحلي في حالة عدم توفر الاتصال بقاعدة البيانات
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">رمز المستخدم</label>
              <input
                type="text"
                value={userCode}
                onChange={(e) => setUserCode(e.target.value)}
                className="w-full p-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="أدخل رمز المستخدم..."
                required
                disabled={isLoading}
              />
              <p className="text-xs text-gray-500 mt-1">سجّل أي رمز يناسبك (مثال: omar_dev)</p>
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-blue-600 text-white py-3 rounded-md hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                  جاري تسجيل الدخول...
                </>
              ) : ('دخول')}
            </button>
          </form>
        </div>
      </div>
    );
  };

  // ===== توليد رمز واحد فقط في كل مرة =====
  const createSingleQRCode = async (guestsPerCode, phone, customName) => {
    if (!userData?.userCode) return;
    const seq = storeData.guestsList.length + 1;
    const groupId = `GROUP_${seq}_${Math.random().toString(36).substr(2, 6)}`;

    const name = customName?.trim() ? customName.trim() : `مجموعة ${seq}`;
    const nameEnc = encodeURIComponent(name);

    const qrData = generateQRData(userData.userCode, groupId, guestsPerCode, phone, nameEnc);
    const link = `${window.location.origin}/invite?qr=${encodeURIComponent(qrData)}`;
   const qrImageUrl = await generateQRCode(link);

    const newGuest = {
      id: groupId,
      name,
      phone: phone || '',
      attended: 0,
      maxGuests: guestsPerCode,
      qrCode: qrData,
      qrImageUrl,
      inviteUrl: link,
      isEditing: false,
      editName: ''
    };

    setStoreData(prev => ({
      ...prev,
      totalGuests: prev.totalGuests + guestsPerCode,
      guestsList: [...prev.guestsList, newGuest]
    }));
  };

  // ===== تحميل صور QR =====
  const downloadQRCode = async (guest) => {
    try {
      if (guest.qrImageUrl) {
        const link = document.createElement('a');
        link.href = guest.qrImageUrl;
        link.download = `QR_${guest.name.replace(/\s+/g, '_')}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    } catch (error) {
      console.error('خطأ في تحميل الصورة:', error);
    }
  };

  const downloadAllQRCodes = async () => {
    for (const guest of storeData.guestsList) {
      await downloadQRCode(guest);
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  };

  // ===== تصدير CSV (UTF-8 BOM + رقم الهاتف كنص) =====
  const exportCSV = () => {
    if (!storeData.guestsList.length) return alert("لا توجد بيانات لتصديرها.");

    const headers = ["الاسم", "رقم الهاتف", "عدد الضيوف", "QR Code", "رابط الدعوة"];
    const rows = storeData.guestsList.map(g => [
      (g.name || '').replace(/,/g, ' '),
      `"${g.phone || ''}"`,       // نحافظ على الرقم كنص لتفادي الصيغة العلمية
      g.maxGuests ?? 0,
      (g.qrCode || '').replace(/,/g, ' '),
      g.inviteUrl || `${window.location.origin}/invite?qr=${encodeURIComponent(g.qrCode || '')}`
    ]);

    const csvLines = [headers, ...rows].map(cols => cols.join(',')).join('\n');
    const blob = new Blob(
      ["\uFEFF" + csvLines],      // UTF-8 BOM
      { type: 'text/csv;charset=utf-8;' }
    );
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'qr_export.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
const extractQRPayload = (input) => {
  try {
    const u = new URL(input);
    const q = u.searchParams.get("qr");
    return q ? decodeURIComponent(q) : input;
  } catch {
    return input;
  }
};
  // ===== مسح QR =====
const handleScan = async (data) => {
  if (!data) return;
  setScanResult('جاري التحقق من الرمز...');

  // ✅ دعم الروابط
  const payload = extractQRPayload(data);

  const group = storeData.guestsList.find(g => g.qrCode === payload);
  if (group) {
    if (group.attended < group.maxGuests) {
      const updatedGuests = storeData.guestsList.map(g =>
        g.id === group.id ? { ...g, attended: g.attended + 1 } : g
      );
      const newData = {
        ...storeData,
        guestsList: updatedGuests,
        attendedGuests: storeData.attendedGuests + 1,
      };
      setStoreData(newData);
      setScanResult(`تم تسجيل حضور ضيف من ${group.name}!`);
      await supabaseUpsert(userData.userCode, newData);
    } else {
      setScanResult('تم بلوغ الحد الأقصى لهذه المجموعة.');
    }
  } else {
    setScanResult('QR Code غير صالح');
  }
};

  // معالجة qr بالروابط (في الصفحة الرئيسية فقط)
  useEffect(() => {
    if (route !== 'app' || !userData) return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get('qr');
    if (code) {
      handleScan(code);
      params.delete('qr');
      const newQuery = params.toString();
      window.history.replaceState({}, '', `${window.location.pathname}${newQuery ? '?' + newQuery : ''}`);
    }
  }, [route, userData]);

  // ===== أدوات الكاميرا =====


  // ===== إعادة تعيين =====
  const resetSystem = async () => {
    if (!userData?.userCode) return;
    const confirmReset = window.confirm('هل أنت متأكد من حذف كل بياناتك من قاعدة البيانات؟ الإجراء لا يمكن التراجع عنه.');
    if (!confirmReset) return;

    try {
      await supabaseDeleteAll(userData.userCode);
      clearLocal(userData.userCode);
      setStoreData({ eventTimeISO: null, totalGuests: 0, attendedGuests: 0, guestsList: [] });
      setScanResult('');
      alert('تم حذف جميع بيانات المستخدم من قاعدة البيانات.');
    } catch (e) {
      console.error('فشل الحذف:', e?.message);
      alert('حدث خطأ أثناء الحذف. تحقق من الاتصال.');
    }
  };

  // ===== تسجيل خروج =====
  const handleLogout = () => {
    const confirmLogout = window.confirm('هل تريد تسجيل الخروج؟');
    if (!confirmLogout) return;
    if (userData?.userCode) clearLocal(userData.userCode);
    localStorage.removeItem(LAST_USER_KEY);
    setUserData(null);
    setStoreData({ eventTimeISO: null, totalGuests: 0, attendedGuests: 0, guestsList: [] });
    setIsAuthenticated(false);
    setCurrentView('login');
  };

  // ===== واجهة المنظم =====
  const OrganizerView = () => {
    const attendancePercent = storeData.totalGuests > 0
      ? Math.round((storeData.attendedGuests / storeData.totalGuests) * 100)
      : 0;

    const eventLocalValue = storeData.eventTimeISO ? fmtDateTimeLocal(storeData.eventTimeISO) : '';

    return (
      <div className="space-y-6">
        <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white p-6 rounded-lg">
          <h2 className="text-2xl font-bold mb-2">مرحباً {userData.userCode}</h2>
          <p className="opacity-90">لوحة تحكم المنظّم {isAuthenticated ? ' (متصل بقاعدة البيانات)' : ' (تخزين محلي)'} </p>
        </div>

        {/* إعداد وقت الفعالية */}
        <div className="bg-white p-4 rounded-lg shadow border">
          <div className="flex items-center gap-3 mb-3">
            <Clock className="w-5 h-5 text-indigo-600" />
            <h3 className="font-semibold text-gray-800">وقت الفعالية</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium mb-2">حدد التاريخ والوقت</label>
              <input
                type="datetime-local"
                value={eventLocalValue}
                onChange={(e) => {
                  const iso = fromDateTimeLocalToISO(e.target.value);
                  setStoreData(prev => ({ ...prev, eventTimeISO: iso }));
                }}
                className="w-full p-3 border rounded-md"
              />
              <p className="text-xs text-gray-500 mt-1">سيظهر الـQR للضيوف قبل موعد الفعالية بنصف ساعة فقط.</p>
            </div>
            <div className="flex items-end gap-2">
              <button
                onClick={() => {
                  if (!storeData.eventTimeISO) return alert('اختر وقت الفعالية أولاً');
                  alert('تم حفظ وقت الفعالية. سيتم تطبيقه على جميع الروابط.');
                }}
                className="w-full px-4 py-3 rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
              >
                حفظ الوقت
              </button>

              {/* أزرار تشغيل/إيقاف الماسح — لاستخدام setShowScanner */}
            </div>
          </div>
        </div>

        {/* إحصائيات عامة */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
          <div className="bg-blue-50 p-3 sm:p-4 rounded-lg border border-blue-200">
            <div className="flex items-center gap-2 sm:gap-3">
              <Users className="w-8 h-8 text-blue-600" />
              <div>
                <p className="text-sm text-blue-600">إجمالي الضيوف</p>
                <p className="text-2xl font-bold text-blue-800">{storeData.totalGuests}</p>
              </div>
            </div>
          </div>
          <div className="bg-green-50 p-4 rounded-lg border border-green-200">
            <div className="flex items-center gap-3">
              <CheckCircle className="w-8 h-8 text-green-600" />
              <div>
                <p className="text-sm text-green-600">حضر فعلاً</p>
                <p className="text-2xl font-bold text-green-800">{storeData.attendedGuests}</p>
              </div>
            </div>
          </div>
          <div className="bg-orange-50 p-4 rounded-lg border border-orange-200">
            <div className="flex items-center gap-3">
              <Users className="w-8 h-8 text-orange-600" />
              <div>
                <p className="text-sm text-orange-600">لم يحضر بعد</p>
                <p className="text-2xl font-bold text-orange-800">{Math.max(storeData.totalGuests - storeData.attendedGuests, 0)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* شريط تقدم عام */}
        <div className="bg-white p-4 rounded-lg shadow-md border">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium">نسبة الحضور</span>
            <span className="text-sm text-gray-500">{attendancePercent}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3">
            <div className="bg-gradient-to-r from-green-500 to-blue-500 h-3 rounded-full transition-all duration-500" style={{ width: `${attendancePercent}%` }}></div>
          </div>
        </div>

        {/* عمليات رئيسية */}
        <div className="bg-white p-3 sm:p-4 rounded-lg shadow">
          <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 items-stretch sm:items-center justify-between">
            <div className="flex flex-wrap gap-3">
              <button
                onClick={downloadAllQRCodes}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-gray-800 text-white hover:bg-black transition-colors"
              >
                <Download className="w-4 h-4" />
                تحميل كل رموز QR
              </button>

              <button
                onClick={() => setShowAppendPanel(v => !v)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
              >
                <PlusCircle className="w-4 h-4" />
                إضافة رمز جديد
              </button>

              <button
                onClick={exportCSV}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-green-600 text-white hover:bg-green-700 transition-colors"
              >
                <Download className="w-4 h-4" />
                تصدير CSV
              </button>

              <button
                onClick={resetSystem}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-red-600 text-white hover:bg-red-700 transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                إعادة التعيين (حذف كلي)
              </button>
            </div>

            <p className="mt-4 text-sm text-gray-600">
              المسح يتم حصراً من هاتف الأدمن. عند مسح QR سيفتح الرابط ويسجَّل الحضور تلقائياً.
            </p>

            <button
              onClick={handleLogout}
              className="px-4 py-2 rounded-md border border-gray-300 hover:bg-gray-50 transition-colors"
            >
              تسجيل الخروج
            </button>
          </div>

          {/* لوحة الإضافة */}
          {showAppendPanel && (
            <div className="mt-4 border rounded-lg p-4 bg-indigo-50">
              <h5 className="font-semibold mb-3">إنشاء رمز واحد وتحديد عدد المدعوين + رقم هاتف</h5>
              <AppendPanel />
            </div>
          )}
        </div>

        {/* حالة فارغة */}
        {storeData.guestsList.length === 0 && (
          <div className="bg-white p-6 rounded-lg border text-center">
            <h4 className="text-lg font-semibold mb-2">لا توجد رموز QR بعد</h4>
            <p className="text-gray-600 mb-4">اضغط "إضافة رمز جديد" لإنشاء الرمز وربطه بحسابك في قاعدة البيانات.</p>
            <button
              onClick={() => setShowAppendPanel(true)}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
            >
              <PlusCircle className="w-5 h-5" />
              إنشاء أول رمز
            </button>
          </div>
        )}

        {/* قائمة الرموز */}
        {storeData.guestsList.length > 0 && (
          <div className="bg-white p-4 sm:p-6 rounded-lg shadow-md border">
            <h4 className="text-lg font-semibold mb-4">الرموز المولدة</h4>

            {scanResult && <div className="mb-4 p-3 rounded-md border text-sm bg-gray-50">{scanResult}</div>}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {storeData.guestsList.map((g) => {
                const done = g.attended >= g.maxGuests;
                const percent = g.maxGuests > 0 ? Math.min(100, Math.round((g.attended / g.maxGuests) * 100)) : 0;

                return (
                  <div
                    key={g.id}
                    className={`relative border rounded-lg p-3 transition ${done ? 'border-green-300 bg-green-50/40 opacity-70 pointer-events-none' : 'bg-white'}`}
                    aria-disabled={done}
                  >
                    {/* شارة الاكتمال */}
                    {done && (
                      <div className="absolute top-2 left-2 flex items-center gap-1 text-green-700 bg-green-100/80 px-2 py-1 rounded-md text-xs">
                        <CheckCircle className="w-4 h-4" />
                        اكتمل
                      </div>
                    )}

                    {/* رأس البطاقة */}
                    <div className="flex items-start justify-between mb-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h5 className="font-medium truncate">👥 {g.name}</h5>
                        </div>
                        <div className="mt-1 text-sm">
                          <span className={`font-semibold ${done ? 'text-green-700' : 'text-gray-800'}`}>{g.attended}</span>
                          <span className="text-gray-500"> / {g.maxGuests}</span>
                          <span className="mx-2 text-gray-400">|</span>
                          <span className={`text-xs ${done ? 'text-green-700' : 'text-gray-500'}`}>{percent}%</span>
                        </div>
                        <div className="mt-1 text-xs text-gray-600">
                          📞 رقم الهاتف: <span className="font-medium">{g.phone || '—'}</span>
                        </div>
                        <div className="mt-1 text-xs">
                          🔗 رابط الدعوة:{" "}
                          <a href={g.inviteUrl} target="_blank" rel="noreferrer" className="text-indigo-600 underline break-all">
                            {g.inviteUrl}
                          </a>
                        </div>
                      </div>

                      {/* تعديل الاسم */}
                      <div className="flex items-center gap-2">
                        {!g.isEditing ? (
                          <button
                            onClick={() =>
                              setStoreData((prev) => ({
                                ...prev,
                                guestsList: prev.guestsList.map((x) =>
                                  x.id === g.id ? { ...x, isEditing: true, editName: g.name } : x
                                ),
                              }))
                            }
                            className="p-2 rounded-md border hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                            title="تعديل الاسم"
                            disabled={done}
                          >
                            <Settings className="w-4 h-4" />
                          </button>
                        ) : (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => {
                                setStoreData((prev) => ({
                                  ...prev,
                                  guestsList: prev.guestsList.map((x) =>
                                    x.id === g.id ? { ...x, name: x.editName || g.name, isEditing: false } : x
                                  ),
                                }));
                              }}
                              className="px-2 py-1 rounded-md bg-green-600 text-white text-sm"
                            >
                              حفظ
                            </button>
                            <button
                              onClick={() =>
                                setStoreData((prev) => ({
                                  ...prev,
                                  guestsList: prev.guestsList.map((x) =>
                                    x.id === g.id ? { ...x, isEditing: false, editName: '' } : x
                                  ),
                                }))
                              }
                              className="px-2 py-1 rounded-md border text-sm"
                            >
                              إلغاء
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* تقدم المجموعة */}
                    <div className="mb-3">
                      <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
                        <div
                          className={`h-2.5 rounded-full transition-all duration-500 ${done ? 'bg-green-600' : 'bg-gradient-to-r from-green-500 to-blue-500'}`}
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                      <div className={`mt-1 text-xs ${done ? 'text-green-700' : 'text-gray-500'}`}>
                        {done ? 'تم اكتمال حضور هذه المجموعة' : 'تقدم حضور المجموعة'}
                      </div>
                    </div>

                    {/* صورة الـ QR */}
                    {g.qrImageUrl ? (
                      <div className={`rounded-md p-3 flex flex-col items-center gap-3 border ${done ? 'border-green-300 bg-white/50' : 'bg-gray-50 border-gray-200'}`}>
                        <div className="relative">
                          <img
                            src={g.qrImageUrl}
                            alt={g.name}
                            className={`w-40 h-40 object-contain transition ${done ? 'opacity-50 grayscale-[30%]' : ''}`}
                            loading="lazy"
                          />
                          {done && <div className="absolute inset-0 rounded-md ring-2 ring-green-500/70 pointer-events-none"></div>}
                        </div>

                        <button
                          onClick={() => downloadQRCode(g)}
                          className={`inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors
                            ${done ? 'bg-green-600 text-white' : 'bg-gray-800 text-white hover:bg-black'}
                            disabled:opacity-50 disabled:cursor-not-allowed`}
                          disabled={done}
                          tabIndex={done ? -1 : 0}
                        >
                          <Download className="w-4 h-4" />
                          تحميل QR
                        </button>
                      </div>
                    ) : (
                      <div className="text-xs text-gray-500">لا توجد صورة QR</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  // لوحة إدخال القيم لعملية الإنشاء (رمز واحد فقط)
  const AppendPanel = () => {
    const [perCode, setPerCode] = useState(2);
    const [phone, setPhone] = useState('');
    const [customName, setCustomName] = useState('');
    const [busy, setBusy] = useState(false);

    const handle = async () => {
      if (busy) return;
      if (!storeData.eventTimeISO) {
        const ok = window.confirm('لم تحدد وقت الفعالية. هل تريد الاستمرار؟ (سيظل الرابط يعمل لكن بدون عدّاد)');
        if (!ok) return;
      }
      if (!phone.trim()) {
        alert('يرجى إدخال رقم الهاتف لهذا الرمز.');
        return;
      }
      if (perCode <= 0) {
        alert('عدد الضيوف يجب أن يكون 1 على الأقل.');
        return;
      }
      setBusy(true);
      await createSingleQRCode(perCode, phone.trim(), customName);
      setBusy(false);
      setCustomName('');
      setPhone('');
      setPerCode(2);
    };

    return (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-sm font-medium mb-2">اسم الرمز (اختياري)</label>
          <input
            type="text"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            className="w-full p-3 border border-gray-300 rounded-md"
            placeholder="مثال: عائلة علي"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">عدد الضيوف داخل هذا الرمز</label>
          <input
            type="number"
            value={perCode}
            onChange={(e) => setPerCode(parseInt(e.target.value) || 0)}
            className="w-full p-3 border border-gray-300 rounded-md text-center"
            min="1"
            max="20"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">رقم الهاتف (لهذا الرمز)</label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full p-3 border border-gray-300 rounded-md"
            placeholder="مثال: 07xxxxxxxxx"
          />
        </div>
        <div className="sm:col-span-3 flex items-end">
          <button
            onClick={handle}
            disabled={busy || perCode <= 0 || !phone.trim()}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-50"
          >
            {busy ? 'جاري الإنشاء...' : 'إنشاء الرمز الآن'}
          </button>
        </div>
      </div>
    );
  };

  // ===== صفحة الدعوة /invite =====
  const InviteView = () => {
    const [qrParam, setQrParam] = useState(null);
    const [qrImg, setQrImg] = useState(null);
    const [now, setNow] = useState(Date.now());
    const [eventTimeMs, setEventTimeMs] = useState(null);
    const [guestName, setGuestName] = useState('ضيفنا الكريم'); // ← تعريف guestName لتفادي no-undef

    // قراءة qr من الرابط
    useEffect(() => {
      const params = new URLSearchParams(window.location.search);
      const q = params.get('qr');
      setQrParam(q || null);
    }, []);

    // عداد الوقت
    useEffect(() => {
      const t = setInterval(() => setNow(Date.now()), 1000);
      return () => clearInterval(t);
    }, []);

    // جلب وقت الحدث (Global) من Supabase باستخدام USER داخل الـQR
    useEffect(() => {
      const fetchEventTime = async () => {
        if (!qrParam) return;
        const data = parseQRData(qrParam);
        const name = data.NAME ? decodeURIComponent(data.NAME) : 'ضيفنا الكريم';
        setGuestName(name);

        const userCode = data.USER;
        if (!userCode) return;

        try {
          const { data: row, error } = await supabase
            .from('user_qr_codes')
            .select('event_time')
            .eq('email', userCode)
            .limit(1)
            .single();

          if (!error && row?.event_time) {
            setEventTimeMs(new Date(row.event_time).getTime());
          } else {
            setEventTimeMs(null);
          }
        } catch (_) {
          setEventTimeMs(null);
        }
      };
      fetchEventTime();
    }, [qrParam]);

    // تحضير صورة الـQR عندما يحين وقت الإظهار (نصف ساعة قبل الحدث)
    useEffect(() => {
      const make = async () => {
        if (!qrParam) return;

        // لو ماكو وقت عام محفوظ، نظهر QR مباشرةً
        if (!eventTimeMs || isNaN(eventTimeMs)) {
          const img = await generateQRCode(qrParam);
          setQrImg(img);
          return;
        }

        const diff = eventTimeMs - now;
        const thirtyMin = 30 * 60 * 1000;
        if (diff <= thirtyMin) {
          const img = await generateQRCode(qrParam);
          setQrImg(img);
        } else {
          setQrImg(null);
        }
      };
      make();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [qrParam, now, eventTimeMs]);

    if (!qrParam) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="bg-white p-8 rounded-lg shadow text-center">
            <h1 className="text-xl font-bold mb-2">رابط غير صالح</h1>
            <p className="text-gray-600">يرجى التأكد من صحة رابط الدعوة.</p>
          </div>
        </div>
      );
    }

    const thirtyMin = 30 * 60 * 1000;
const showQR = eventTimeMs ? (eventTimeMs - now <= thirtyMin) : true;

// الوقت المتبقي لبداية الحدث (ميلي ثانية)
const remaining = Math.max((eventTimeMs ?? 0) - now, 0);
// تفكيك العدّاد
const remDays = Math.floor(remaining / (24 * 60 * 60 * 1000));
const remHours = Math.floor((remaining % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
const remMinutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
const remSeconds = Math.floor((remaining % (60 * 1000)) / 1000);
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50" dir="rtl">
        <div className="bg-white p-8 rounded-lg shadow w-full max-w-md text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">أهلا بكم !</h1>

          {/* قبل 30 دقيقة: نعرض اسم الضيف بدل العداد */}
          {eventTimeMs && !showQR && (
  <div className="mb-6">
    <div className="text-2xl font-bold text-gray-900">مرحبًا، {guestName} 👋</div>
    <p className="text-sm text-gray-600 mt-2">
      يبدأ الحدث في: <span className="font-medium">{new Date(eventTimeMs).toLocaleString()}</span>
    </p>

    {/* عدّاد لبداية الحدث */}
    <div className="mt-4">
      <p className="text-sm text-gray-500 mb-2">الوقت المتبقي لبداية الحدث:</p>
      <div className="grid grid-cols-4 gap-2 text-center">
        <div className="bg-gray-100 rounded-md p-3">
          <div className="text-2xl font-bold">{String(remDays).padStart(2, '0')}</div>
          <div className="text-xs text-gray-600 mt-1">يوم</div>
        </div>
        <div className="bg-gray-100 rounded-md p-3">
          <div className="text-2xl font-bold">{String(remHours).padStart(2, '0')}</div>
          <div className="text-xs text-gray-600 mt-1">ساعة</div>
        </div>
        <div className="bg-gray-100 rounded-md p-3">
          <div className="text-2xl font-bold">{String(remMinutes).padStart(2, '0')}</div>
          <div className="text-xs text-gray-600 mt-1">دقيقة</div>
        </div>
        <div className="bg-gray-100 rounded-md p-3">
          <div className="text-2xl font-bold">{String(remSeconds).padStart(2, '0')}</div>
          <div className="text-xs text-gray-600 mt-1">ثانية</div>
        </div>
      </div>
      <p className="text-xs text-gray-500 mt-3">
        سيتاح رمز الدخول قبل موعد الفعالية بـ 30 دقيقة تلقائيًا.
      </p>
    </div>
  </div>
)}


          {/* QR عند اقتراب الحدث */}
          {showQR && (
            <div className="flex flex-col items-center gap-4">
              <p className="text-green-700 font-medium">رمز الدخول جاهز للمسح ✅</p>
              <p className="text-base text-gray-800">على اسم: <span className="font-semibold">{guestName}</span></p>
              {qrImg ? (
                <img src={qrImg} alt="QR" className="w-56 h-56 object-contain" />
              ) : (
                <div className="text-sm text-gray-500">جاري تحضير الرمز…</div>
              )}
              <p className="text-xs text-gray-500">يرجى إبقاء الشاشة مضاءة لإتمام عملية الدخول بسرعة.</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  // ===== العرض =====
  if (route === 'invite') return <InviteView />;
  return currentView === 'login' ? <LoginForm /> : (
    <div className="min-h-screen bg-gray-50" dir="rtl">
      <div className="max-w-6xl mx-auto p-4 sm:p-6">
        <OrganizerView />
        {/* حاوية الماسح */}
        {scanResult && <div className="mt-3 bg-white border p-3 rounded">{scanResult}</div>}
      </div>
    </div>
  );
};

export default QRAttendanceSystem;
