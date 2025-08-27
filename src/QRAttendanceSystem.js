"use client";
import React, { useState, useEffect } from 'react';
import { QrCode, Users, CheckCircle, RotateCcw, Settings, Download, PlusCircle, Clock, Smartphone, ExternalLink } from 'lucide-react';
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
  const [route, setRoute] = useState('app'); // 'app' | 'invite' | 'qr-display'
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
  // إزالة showScanner لأننا لن نستخدم الماسح المدمج
  // const [showScanner, setShowScanner] = useState(false);

  // ===== Routing بدائي: /qr-display => QRDisplayView، الباقي في الصفحة الرئيسية
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const path = window.location.pathname || '/';
    if (path.startsWith('/qr-display')) setRoute('qr-display');
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
    // استخدام دومين Vercel الثابت
    const link = `https://qr-event-scanner2.vercel.app/?qr=${qrData}`;
    // تغيير محتوى QR Code ليحتوي على الرابط الكامل بدلاً من البيانات فقط
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

    const headers = ["الاسم", "رقم الهاتف", "عدد الضيوف", "QR Code", "رابط عرض QR"];
    
    const rows = storeData.guestsList.map(g => [
      (g.name || '').replace(/,/g, ' '),
      `"${g.phone || ''}"`,
      g.maxGuests ?? 0,
      (g.qrCode || '').replace(/,/g, ' '),
      `https://qr-event-scanner2.vercel.app/qr-display?guest=${encodeURIComponent(g.id)}`
    ]);

    const csvLines = [headers, ...rows].map(cols => cols.join(',')).join('\n');
    const blob = new Blob(
      ["\uFEFF" + csvLines],
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

  // ===== تسجيل الحضور في قاعدة البيانات =====
  const recordAttendance = async (guestData, userCode) => {
    try {
      const attendanceRecord = {
        guest_id: guestData.GUEST,
        guest_name: guestData.NAME ? decodeURIComponent(guestData.NAME) : 'ضيف',
        phone: guestData.PHONE || '',
        user_code: userCode,
        scan_time: new Date().toISOString(),
        event_time: storeData.eventTimeISO,
        guest_count: parseInt(guestData.COUNT) || 1
      };

      // محاولة إدراج في جدول attendance_records
      const { error: insertError } = await supabase
        .from('attendance_records')
        .insert(attendanceRecord);

      if (insertError) {
        console.warn('فشل في إدراج سجل الحضور:', insertError.message);
        // fallback: حفظ في التخزين المحلي
        const localKey = `attendance_${guestData.GUEST}_${Date.now()}`;
        localStorage.setItem(localKey, JSON.stringify(attendanceRecord));
        return false;
      }

      return true;
    } catch (error) {
      console.error('خطأ في تسجيل الحضور:', error);
      return false;
    }
  };

  // ===== جلب سجلات الحضور =====
  const getAttendanceRecords = async () => {
    if (!userData?.userCode) return [];
    
    try {
      const { data, error } = await supabase
        .from('attendance_records')
        .select('*')
        .eq('user_code', userData.userCode)
        .order('scan_time', { ascending: false });

      if (error) {
        console.warn('فشل في جلب سجلات الحضور:', error.message);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('خطأ في جلب سجلات الحضور:', error);
      return [];
    }
  };

  // ===== تحديث سجل صاحب الـ QR (زيادة attended لمجموعة محددة) =====
  const markOwnerGuestAttended = async (ownerCode, guestId) => {
    if (!ownerCode || !guestId) return false;
    try {
      // حاول تحديث صف user_qr_codes أولاً
      const { data: ownerRow, error: ownerErr } = await supabase
        .from('user_qr_codes')
        .select('*')
        .eq('email', ownerCode)
        .limit(1)
        .single();

      if (!ownerErr && ownerRow) {
        const guests = ownerRow.guests || [];
        const idx = guests.findIndex(g => g.id === guestId);
        if (idx === -1) {
          // المجموعة غير موجودة لدى المالك
          return false;
        }

        // منع تجاوز الحد الأقصى
        const current = guests[idx].attended || 0;
        const maxG = guests[idx].maxGuests || 0;
        if (maxG > 0 && current >= maxG) {
          // لا يمكن زيادة أكثر من الحد
          return false;
        }

        guests[idx].attended = current + 1;
        const newAttendedTotal = (ownerRow.attended_guests || 0) + 1;

        const upsertPayload = {
          email: ownerCode,
          event_time: ownerRow.event_time || null,
          total_guests: ownerRow.total_guests || (guests.reduce((s, gg) => s + (gg.maxGuests || 0), 0)),
          attended_guests: newAttendedTotal,
          guests: guests,
          updated_at: new Date().toISOString()
        };

        const { error: upsertErr } = await supabase
          .from('user_qr_codes')
          .upsert(upsertPayload, { onConflict: 'email' });

        if (!upsertErr) return true;

        console.warn('upsert to user_qr_codes failed, trying event_history fallback:', upsertErr.message || upsertErr);
      }

      // fallback: حاول تحديث أحدث سجل في event_history
      const { data: histRow, error: histErr } = await supabase
        .from('event_history')
        .select('*')
        .eq('email', ownerCode)
        .order('ended_at', { ascending: false })
        .limit(1)
        .single();

      if (!histErr && histRow) {
        const guests = histRow.guests || [];
        const idx = guests.findIndex(g => g.id === guestId);
        if (idx === -1) return false;

        const current = guests[idx].attended || 0;
        const maxG = guests[idx].maxGuests || 0;
        if (maxG > 0 && current >= maxG) return false;

        guests[idx].attended = current + 1;
        const newAttendedTotal = (histRow.attended_guests || 0) + 1;

        const upsertPayload = {
          email: ownerCode,
          event_name: histRow.event_name || null,
          event_id: histRow.event_id || null,
          event_time: histRow.event_time || null,
          total_guests: histRow.total_guests || (guests.reduce((s, gg) => s + (gg.maxGuests || 0), 0)),
          attended_guests: newAttendedTotal,
          guests: guests,
          ended_at: histRow.ended_at || new Date().toISOString()
        };

        const { error: upsertErr2 } = await supabase
          .from('event_history')
          .upsert(upsertPayload, { onConflict: 'email' });

        if (!upsertErr2) return true;
        console.error('Fallback upsert to event_history failed:', upsertErr2.message || upsertErr2);
      }

      return false;
    } catch (e) {
      console.error('markOwnerGuestAttended error:', e);
      return false;
    }
  };

  // ===== مسح QR محدث =====
  const handleScan = async (data) => {
    if (!data) return;
    setScanResult('جاري التحقق من الرمز...');

    try {
      // إذا الماسح أعاد رابط كامل مثل https://.../invite?qr=...
      let decoded = data;
      try {
        decoded = decodeURIComponent(data);
      } catch (_) {
        // keep original if decode fails
      }

      // إذا هو رابط يحتوي معلمة qr=... استخرج قيمة qr
      if (decoded.includes('?qr=') || decoded.includes('&qr=')) {
        try {
          const url = new URL(decoded, window.location.origin);
          const qrParam = url.searchParams.get('qr');
          if (qrParam) decoded = qrParam;
        } catch (_) {
          // محاولة استخراج يدوياً
          const m = decoded.match(/[?&]qr=([^&]+)/);
          if (m && m[1]) decoded = decodeURIComponent(m[1]);
        }
      }

      // الآن decoded يجب أن يكون نص QR الفعلي (USER:...|GUEST:...|...)
      const qrData = parseQRData(decoded);

      if (!qrData.USER || !qrData.GUEST) {
        setScanResult('QR Code غير صالح - بيانات ناقصة');
        setTimeout(() => setScanResult(''), 3000);
        return;
      }

      const ownerCode = qrData.USER;
      const guestId = qrData.GUEST;
      const isLocalOwner = ownerCode === userData?.userCode;
      const group = storeData.guestsList.find(g => g.id === guestId);

      // إذا المالك محلياً ولكن المجموعة غير موجودة → خطأ محلي
      if (isLocalOwner && !group) {
        setScanResult('مجموعة غير موجودة في النظام');
        setTimeout(() => setScanResult(''), 3000);
        return;
      }

      // إذا المالك محلياً وتجاوز الحد → منع
      if (isLocalOwner && group && group.attended >= group.maxGuests) {
        setScanResult(`تم بلوغ الحد الأقصى لهذه المجموعة (${group.maxGuests} ضيف)`);
        setTimeout(() => setScanResult(''), 3000);
        return;
      }

      // سجّل دائماً سجل الحضور العام
      await recordAttendance(qrData, ownerCode);

      if (isLocalOwner && group) {
        // حدث الحالة محلياً وحافظ على التناسق في DB
        const updatedGuests = storeData.guestsList.map(g =>
          g.id === group.id ? { ...g, attended: g.attended + 1 } : g
        );

        const newData = {
          ...storeData,
          guestsList: updatedGuests,
          attendedGuests: storeData.attendedGuests + 1,
        };

        setStoreData(newData);

        try {
          const ok = await supabaseUpsert(userData.userCode, newData);
          if (!ok) saveLocal(userData.userCode, newData);
        } catch (e) {
          console.error('خطأ في حفظ التحديث المحلي:', e);
          saveLocal(userData.userCode, newData);
        }

        setScanResult(`✅ تم تسجيل حضور داخل حسابك: ${group.name} (${group.attended + 1}/${group.maxGuests})`);
      } else {
        // الحارس يمسح رمز تابع لمالك آخر: حدث سجل المالك في DB
        const ownerMarked = await markOwnerGuestAttended(ownerCode, guestId);
        setScanResult(ownerMarked
          ? `✅ تم تسجيل حضور وتم تحديث صاحب الكود (${ownerCode})`
          : `✅ تم تسجيل حضور (لم يتم تحديث سجل صاحب الكود تلقائياً أو وصل الحد)`);
      }

      // الحارس يبقى في لوحة التحكم بدون إعادة تحميل
      setTimeout(() => {
        setScanResult('');
        // setShowScanner(false); // إيقاف الماسح
      }, 2000);

    } catch (error) {
      console.error('خطأ في معالجة QR:', error);
      setScanResult('حدث خطأ في معالجة الرمز');
      setTimeout(() => setScanResult(''), 3000);
    }
  };

  // معالجة qr بالروابط من كاميرا الموبايل في الصفحة الرئيسية
  useEffect(() => {
    if (route !== 'app') return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get('qr');
    if (code) {
      // إذا كان المستخدم مسجل دخول، عامل الكود كمسح عادي
      if (userData) {
        handleScan(code);
        params.delete('qr');
        const newQuery = params.toString();
        window.history.replaceState({}, '', `${window.location.pathname}${newQuery ? '?' + newQuery : ''}`);
      } else {
        // إذا لم يكن مسجل دخول، اعرض واجهة الدعوة
        setRoute('invite');
      }
    }
  }, [route, userData]);

  // ===== أدوات الكاميرا =====
  // تمت إزالة جميع دوال الكاميرا والماسح المدمج

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

  // ===== واجهة المنظم محدثة =====
  const OrganizerView = () => {
    const [attendanceRecords, setAttendanceRecords] = useState([]);
    const [showAttendanceList, setShowAttendanceList] = useState(false);

    const attendancePercent = storeData.totalGuests > 0
      ? Math.round((storeData.attendedGuests / storeData.totalGuests) * 100)
      : 0;

    const eventLocalValue = storeData.eventTimeISO ? fmtDateTimeLocal(storeData.eventTimeISO) : '';

    // جلب سجلات الحضور عند تحميل الصفحة
    useEffect(() => {
      if (userData?.userCode) {
        getAttendanceRecords().then(setAttendanceRecords);
      }
    }, [userData, storeData.attendedGuests]);

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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
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
            <div className="flex items-end">
              <button
                onClick={() => {
                  if (!storeData.eventTimeISO) return alert('اختر وقت الفعالية أولاً');
                  alert('تم حفظ وقت الفعالية. سيتم تطبيقه على جميع الروابط.');
                }}
                className="w-full px-4 py-3 rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
              >
                حفظ الوقت
              </button>
            </div>
          </div>
        </div>

        {/* تعليمات المسح بكاميرا الموبايل */}
        <div className="bg-amber-50 p-4 rounded-lg border border-amber-200">
          <div className="flex items-start gap-3">
            <Smartphone className="w-6 h-6 text-amber-600 mt-1" />
            <div>
              <h3 className="font-semibold text-amber-800 mb-2">تعليمات المسح للحارس</h3>
              <div className="text-sm text-amber-700 space-y-1">
                <p>• استخدم تطبيق الكاميرا في موبايلك لمسح QR Code</p>
                <p>• سيتم فتح رابط تلقائياً بعد المسح</p>
                <p>• سيتم تسجيل الحضور فوراً عند فتح الرابط</p>
                <p>• لا حاجة لاستخدام ماسح مدمج في الموقع</p>
              </div>
            </div>
          </div>
        </div>

        {/* نتيجة المسح */}
        {scanResult && (
          <div className={`p-4 rounded-lg border text-center font-medium ${
            scanResult.includes('✅') 
              ? 'bg-green-50 border-green-200 text-green-800'
              : scanResult.includes('خطأ') || scanResult.includes('غير صالح')
              ? 'bg-red-50 border-red-200 text-red-800'
              : 'bg-blue-50 border-blue-200 text-blue-800'
          }`}>
            {scanResult}
          </div>
        )}

        {/* رابط اختبار المسح */}

        {/* إحصائيات عامة */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
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
          <div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
            <div className="flex items-center gap-3">
              <Clock className="w-8 h-8 text-purple-600" />
              <div>
                <p className="text-sm text-purple-600">سجلات الحضور</p>
                <p className="text-2xl font-bold text-purple-800">{attendanceRecords.length}</p>
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
            <div
              className="bg-gradient-to-r from-blue-500 to-green-500 h-3 rounded-full transition-all duration-300"
              style={{ width: `${attendancePercent}%` }}
            ></div>
          </div>
        </div>

        {/* إضافة رموز جديدة */}
        <AddQRSection />

        {/* قائمة المجموعات */}
        <GuestsList />

        {/* سجلات الحضور */}
        <AttendanceRecords records={attendanceRecords} show={showAttendanceList} setShow={setShowAttendanceList} />

        {/* أزرار إدارية */}
        <AdminButtons />
      </div>
    );
  };

  // مكونات فرعية
  const AddQRSection = () => {
    const [guestsPerCode, setGuestsPerCode] = useState(1);
    const [phone, setPhone] = useState('');
    const [customName, setCustomName] = useState('');

    return (
      <div className="bg-white p-4 rounded-lg shadow border">
        <h3 className="font-semibold text-gray-800 mb-4">إضافة رمز QR جديد</h3>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <input
            type="text"
            placeholder="اسم المجموعة"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            className="p-3 border rounded-md"
          />
          <input
            type="tel"
            placeholder="رقم الهاتف"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="p-3 border rounded-md"
          />
          <input
            type="number"
            min="1"
            max="20"
            placeholder="عدد الضيوف"
            value={guestsPerCode}
            onChange={(e) => setGuestsPerCode(parseInt(e.target.value) || 1)}
            className="p-3 border rounded-md"
          />
          <button
            onClick={() => {
              createSingleQRCode(guestsPerCode, phone, customName);
              setCustomName('');
              setPhone('');
              setGuestsPerCode(1);
            }}
            className="px-4 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center justify-center gap-2"
          >
            <PlusCircle className="w-4 h-4" />
            إضافة
          </button>
        </div>
      </div>
    );
  };

  const GuestsList = () => (
    <div className="bg-white rounded-lg shadow border">
      <div className="p-4 border-b">
        <h3 className="font-semibold text-gray-800">قائمة المجموعات</h3>
      </div>
      <div className="divide-y max-h-96 overflow-y-auto">
        {storeData.guestsList.map((guest) => (
          <GuestItem key={guest.id} guest={guest} />
        ))}
        {storeData.guestsList.length === 0 && (
          <div className="p-8 text-center text-gray-500">لا توجد مجموعات بعد</div>
        )}
      </div>
    </div>
  );

  const GuestItem = ({ guest }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editName, setEditName] = useState(guest.name);

    const saveEdit = () => {
      if (!editName.trim()) return;
      setStoreData(prev => ({
        ...prev,
        guestsList: prev.guestsList.map(g =>
          g.id === guest.id ? { ...g, name: editName.trim() } : g
        )
      }));
      setIsEditing(false);
    };

    const deleteGuest = () => {
      if (!window.confirm(`حذف ${guest.name}؟`)) return;
      setStoreData(prev => ({
        ...prev,
        totalGuests: prev.totalGuests - guest.maxGuests,
        attendedGuests: prev.attendedGuests - guest.attended,
        guestsList: prev.guestsList.filter(g => g.id !== guest.id)
      }));
    };

    // دالة نسخ رابط الدعوة
    const copyInviteLink = async () => {
      try {
        await navigator.clipboard.writeText(guest.inviteUrl);
        const button = document.querySelector(`[data-copy-btn="${guest.id}"]`);
        if (button) {
          const originalText = button.innerHTML;
          button.innerHTML = '✅ تم النسخ';
          button.classList.add('bg-green-600', 'text-white');
          setTimeout(() => {
            button.innerHTML = originalText;
            button.classList.remove('bg-green-600', 'text-white');
          }, 2000);
        }
      } catch (error) {
        const textArea = document.createElement('textarea');
        textArea.value = guest.inviteUrl;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        alert('تم نسخ رابط الدعوة');
      }
    };

    // دالة فتح واجهة QR منفصلة
    const openQRDisplay = () => {
      const qrDisplayUrl = `https://qr-event-scanner2.vercel.app/qr-display?guest=${encodeURIComponent(guest.id)}`;
      window.open(qrDisplayUrl, '_blank');
    };

    return (
      <div className="p-4 hover:bg-gray-50">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            {isEditing ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="flex-1 p-2 border rounded"
                  onKeyPress={(e) => e.key === 'Enter' && saveEdit()}
                />
                <button onClick={saveEdit} className="px-3 py-2 bg-green-600 text-white rounded text-sm">حفظ</button>
                <button onClick={() => setIsEditing(false)} className="px-3 py-2 bg-gray-600 text-white rounded text-sm">إلغاء</button>
              </div>
            ) : (
              <div>
                <h4 className="font-medium text-gray-800">{guest.name}</h4>
                <div className="text-sm text-gray-600 flex gap-4">
                  <span>📱 {guest.phone || 'لا يوجد'}</span>
                  <span>👥 {guest.attended}/{guest.maxGuests}</span>
                </div>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={openQRDisplay}
              className="p-2 text-green-600 hover:bg-green-50 rounded transition-colors"
              title="عرض QR في صفحة منفصلة"
            >
              <ExternalLink className="w-4 h-4" />
            </button>
            <button
              onClick={copyInviteLink}
              data-copy-btn={guest.id}
              className="p-2 text-purple-600 hover:bg-purple-50 rounded transition-colors"
              title="نسخ رابط الدعوة"
            >
              📋
            </button>
            <button
              onClick={() => downloadQRCode(guest)}
              className="p-2 text-blue-600 hover:bg-blue-50 rounded"
              title="تحميل QR"
            >
              <Download className="w-4 h-4" />
            </button>
            <button
              onClick={() => setIsEditing(!isEditing)}
              className="p-2 text-gray-600 hover:bg-gray-50 rounded"
              title="تعديل"
            >
              <Settings className="w-4 h-4" />
            </button>
            <button
              onClick={deleteGuest}
              className="p-2 text-red-600 hover:bg-red-50 rounded"
              title="حذف"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>
        
        {guest.qrImageUrl && (
          <div className="mt-3 text-center">
            <img src={guest.qrImageUrl} alt={`QR ${guest.name}`} className="w-32 h-32 mx-auto border rounded" />
            <p className="text-xs text-gray-500 mt-1">QR Code يحتوي على الرابط الكامل</p>
          </div>
        )}
      </div>
    );
  };

  const AttendanceRecords = ({ records, show, setShow }) => (
    <div className="bg-white rounded-lg shadow border">
      <div className="p-4 border-b flex justify-between items-center">
        <h3 className="font-semibold text-gray-800">سجلات الحضور</h3>
        <button
          onClick={() => setShow(!show)}
          className="text-blue-600 hover:text-blue-800"
        >
          {show ? 'إخفاء' : 'عرض'} ({records.length})
        </button>
      </div>
      {show && (
        <div className="divide-y max-h-64 overflow-y-auto">
          {records.map((record, idx) => (
            <div key={idx} className="p-3 text-sm">
              <div className="flex justify-between">
                <span className="font-medium">{record.guest_name}</span>
                <span className="text-gray-500">{new Date(record.scan_time).toLocaleString('ar-SA')}</span>
              </div>
              <div className="text-gray-600 text-xs mt-1">
                📱 {record.phone} | 👥 {record.guest_count} ضيف
              </div>
            </div>
          ))}
          {records.length === 0 && (
            <div className="p-8 text-center text-gray-500">لا توجد سجلات حضور</div>
          )}
        </div>
      )}
    </div>
  );

  const AdminButtons = () => (
    <div className="flex flex-wrap gap-3">
      <button
        onClick={downloadAllQRCodes}
        className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 flex items-center gap-2"
      >
        <Download className="w-4 h-4" />
        تحميل جميع الرموز
      </button>
      <button
        onClick={exportCSV}
        className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 flex items-center gap-2"
      >
        <Download className="w-4 h-4" />
        تصدير CSV
      </button>
      <button
        onClick={resetSystem}
        className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 flex items-center gap-2"
      >
        <RotateCcw className="w-4 h-4" />
        إعادة تعيين
      </button>
      <button
        onClick={handleLogout}
        className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
      >
        تسجيل خروج
      </button>
    </div>
  );

  // واجهة الدعوة
  const InviteView = () => {
    const [qrData, setQrData] = useState(null);
    const [eventReady, setEventReady] = useState(false);

    useEffect(() => {
      const params = new URLSearchParams(window.location.search);
      const qrParam = params.get('qr');
      if (qrParam) {
        const parsed = parseQRData(decodeURIComponent(qrParam));
        setQrData(parsed);
        checkEventTiming(parsed);
      }
    }, []);

    const checkEventTiming = async (data) => {
      if (!data.USER) return;
      try {
        const ownerData = await supabaseLoad(data.USER);
        if (ownerData?.eventTimeISO) {
          const eventTime = new Date(ownerData.eventTimeISO);
          const now = new Date();
          const thirtyMinsBefore = new Date(eventTime.getTime() - 30 * 60 * 1000);
          setEventReady(now >= thirtyMinsBefore);
        } else {
          setEventReady(true); // إذا لم يحدد وقت، اعرض QR
        }
      } catch {
        setEventReady(true);
      }
    };

    if (!qrData) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50" dir="rtl">
          <div className="text-center">
            <QrCode className="w-16 h-16 mx-auto text-gray-400 mb-4" />
            <p className="text-gray-600">رابط غير صالح</p>
          </div>
        </div>
      );
    }

    const guestName = qrData.NAME ? decodeURIComponent(qrData.NAME) : 'ضيف';
    const qrString = Object.entries(qrData).map(([k, v]) => `${k}:${v}`).join('|');

    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50" dir="rtl">
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-md mx-auto bg-white rounded-xl shadow-lg overflow-hidden">
            <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white p-6 text-center">
              <QrCode className="w-12 h-12 mx-auto mb-3" />
              <h1 className="text-xl font-bold">دعوة حضور</h1>
              <p className="opacity-90 mt-1">{guestName}</p>
            </div>

            <div className="p-6">
              {eventReady ? (
                <div className="text-center">
                  <div className="mb-6">
                    <QRCodeDisplay data={qrString} />
                  </div>
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                    <p className="text-green-800 font-medium">أظهر هذا الرمز للحارس</p>
                    <p className="text-green-600 text-sm mt-1">عدد الضيوف: {qrData.COUNT}</p>
                  </div>
                  <div className="text-sm text-gray-600 space-y-1">
                    <p>📱 {qrData.PHONE || 'غير محدد'}</p>
                    <p>🎫 كود المجموعة: {qrData.GUEST}</p>
                  </div>
                </div>
              ) : (
                <div className="text-center">
                  <Clock className="w-16 h-16 mx-auto text-amber-500 mb-4" />
                  <h2 className="text-lg font-semibold text-gray-800 mb-2">لم يحن الوقت بعد</h2>
                  <p className="text-gray-600">سيظهر رمز QR قبل موعد الفعالية بنصف ساعة</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const QRCodeDisplay = ({ data }) => {
    const [qrImage, setQrImage] = useState('');

    useEffect(() => {
      if (data) {
        generateQRCode(data, 250).then(setQrImage);
      }
    }, [data]);

    return qrImage ? (
      <img src={qrImage} alt="QR Code" className="w-64 h-64 mx-auto border-2 border-gray-200 rounded-lg" />
    ) : (
      <div className="w-64 h-64 mx-auto border-2 border-gray-200 rounded-lg flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  };

  // واجهة عرض QR منفصلة
  const QRDisplayView = () => {
    const [guestData, setGuestData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [eventReady, setEventReady] = useState(false);
    const [ownerData, setOwnerData] = useState(null);

    useEffect(() => {
      const loadGuestData = async () => {
        const params = new URLSearchParams(window.location.search);
        const guestId = params.get('guest');
        
        if (!guestId) {
          setLoading(false);
          return;
        }

        try {
          // محاولة العثور على الضيف في جميع المستخدمين
          const { data: users, error } = await supabase
            .from('user_qr_codes')
            .select('*');

          if (error) throw error;

          let foundGuest = null;
          let foundOwner = null;
          for (const user of users || []) {
            const guests = user.guests || [];
            const guest = guests.find(g => g.id === decodeURIComponent(guestId));
            if (guest) {
              foundGuest = guest;
              foundOwner = user;
              break;
            }
          }

          setGuestData(foundGuest);
          setOwnerData(foundOwner);
          
          // فحص وقت الحدث
          if (foundOwner?.event_time) {
            const eventTime = new Date(foundOwner.event_time);
            const now = new Date();
            const thirtyMinsBefore = new Date(eventTime.getTime() - 30 * 60 * 1000);
            setEventReady(now >= thirtyMinsBefore);
          } else {
            setEventReady(true); // إذا لم يحدد وقت، اعرض QR
          }
        } catch (error) {
          console.error('خطأ في تحميل بيانات الضيف:', error);
        }
        
        setLoading(false);
      };

      loadGuestData();
    }, []);

    if (loading) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      );
    }

    if (!guestData) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50" dir="rtl">
          <div className="text-center">
            <QrCode className="w-16 h-16 mx-auto text-gray-400 mb-4" />
            <h1 className="text-xl font-semibold text-gray-800 mb-2">ضيف غير موجود</h1>
            <p className="text-gray-600">لا يمكن العثور على بيانات الضيف المطلوب</p>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50" dir="rtl">
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-2xl mx-auto bg-white rounded-xl shadow-lg overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white p-6 text-center">
              <QrCode className="w-16 h-16 mx-auto mb-4" />
              <h1 className="text-2xl font-bold mb-2">{guestData.name}</h1>
              <p className="opacity-90">رمز QR للحضور</p>
            </div>

            {/* Content */}
            <div className="p-8">
              {eventReady ? (
                <div className="text-center mb-8">
                  <div className="mb-6">
                    {guestData.qrImageUrl && (
                      <img 
                        src={guestData.qrImageUrl} 
                        alt={`QR Code ${guestData.name}`} 
                        className="w-80 h-80 mx-auto border-4 border-gray-200 rounded-xl shadow-lg"
                      />
                    )}
                  </div>
                  
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
                    <p className="text-green-800 font-medium text-lg mb-2">معلومات الدعوة</p>
                    <div className="text-green-700 space-y-2">
                      <p>📱 الهاتف: {guestData.phone || 'غير محدد'}</p>
                      <p>👥 عدد الضيوف: {guestData.maxGuests}</p>
                      <p>✅ حضر: {guestData.attended || 0}</p>
                      <p>🎫 كود المجموعة: {guestData.id}</p>
                    </div>
                  </div>

                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <p className="text-blue-800 font-medium">تعليمات للحارس</p>
                    <p className="text-blue-700 text-sm mt-1">امسح هذا الرمز بكاميرا الموبايل لتسجيل الحضور</p>
                  </div>
                </div>
              ) : (
                <div className="text-center mb-8">
                  <Clock className="w-20 h-20 mx-auto text-amber-500 mb-6" />
                  <h2 className="text-2xl font-semibold text-gray-800 mb-4">لم يحن الوقت بعد</h2>
                  <p className="text-gray-600 text-lg mb-4">سيظهر رمز QR قبل موعد الفعالية بنصف ساعة</p>
                  
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                    <p className="text-amber-800 font-medium text-lg mb-2">معلومات الدعوة</p>
                    <div className="text-amber-700 space-y-2">
                      <p>📱 الهاتف: {guestData.phone || 'غير محدد'}</p>
                      <p>👥 عدد الضيوف: {guestData.maxGuests}</p>
                      <p>✅ حضر: {guestData.attended || 0}</p>
                      <p>🎫 كود المجموعة: {guestData.id}</p>
                      {ownerData?.event_time && (
                        <p>⏰ موعد الفعالية: {new Date(ownerData.event_time).toLocaleString('ar-SA')}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* أزرار إضافية */}
              <div className="flex justify-center gap-4">
                <button
                  onClick={() => window.print()}
                  className="px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 flex items-center gap-2"
                >
                  <Download className="w-5 h-5" />
                  طباعة
                </button>
                <button
                  onClick={() => window.close()}
                  className="px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700"
                >
                  إغلاق
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // العرض الرئيسي
  if (route === 'qr-display') {
    return <QRDisplayView />;
  }

  if (route === 'invite') {
    return <InviteView />;
  }

  if (currentView === 'login') {
    return <LoginForm />;
  }

  return (
    <div className="min-h-screen bg-gray-50" dir="rtl">
      <div className="container mx-auto px-4 py-6">
        <OrganizerView />
      </div>
    </div>
  );
};

export default QRAttendanceSystem;