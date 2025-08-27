"use client";
import React, { useState, useEffect } from 'react';
import { QrCode, Users, CheckCircle, RotateCcw, Settings, Download, PlusCircle } from 'lucide-react';
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

// ربط الـ QR بالمستخدم فقط (لا أحداث)
const generateQRData = (userCode, groupId, guestCount) => {
  return `USER:${userCode}|GUEST:${groupId}|COUNT:${guestCount}|TIME:${Date.now()}`;
};

// ===== الشكل العام للبيانات =====
/*
userData: { userCode, createdAt }
storeData: {
  totalGuests: number,
  attendedGuests: number,
  guestsList: Array<{
    id, name, attended, maxGuests, qrCode, qrImageUrl, isEditing, editName
  }>
}
*/

const QRAttendanceSystem = () => {
  const [currentView, setCurrentView] = useState('login');
  const [userData, setUserData] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const [storeData, setStoreData] = useState({
    totalGuests: 0,
    attendedGuests: 0,
    guestsList: [],
  });

  const [scanResult, setScanResult] = useState('');
  const [showAppendPanel, setShowAppendPanel] = useState(false);

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
      // تأكد من إطفاء أي حالات editing
      parsed.guestsList = (parsed.guestsList || []).map(g => ({ ...g, isEditing: false, editName: '' }));
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
  // جدول مفضّل: user_qr_codes (email primary, guests jsonb, totals, updated_at)
  // fallback:   event_history   (نخزن بدون مفهوم event)
  const supabaseUpsert = async (userCode, data) => {
    // جرّب user_qr_codes أولاً
    try {
      const { error } = await supabase
        .from('user_qr_codes')
        .upsert({
          email: userCode,
          total_guests: data.totalGuests,
          attended_guests: data.attendedGuests,
          guests: data.guestsList.map(g => ({
            id: g.id, name: g.name, attended: g.attended, maxGuests: g.maxGuests, qrCode: g.qrCode, qrImageUrl: g.qrImageUrl
          })),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'email' });
      if (!error) return true;
      console.warn('upsert user_qr_codes error, fallback to event_history:', error?.message);
    } catch (e) {
      console.warn('user_qr_codes not available, fallback:', e?.message);
    }

    // fallback: event_history (نحفظ بدون event_id)
    try {
      const { error } = await supabase
        .from('event_history')
        .upsert({
          email: userCode,
          event_name: null,
          event_id: null,
          total_guests: data.totalGuests,
          attended_guests: data.attendedGuests,
          guests: data.guestsList.map(g => ({
            id: g.id, name: g.name, attended: g.attended, maxGuests: g.maxGuests, qrCode: g.qrCode, qrImageUrl: g.qrImageUrl
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
    // حاول من user_qr_codes
    try {
      const { data, error } = await supabase
        .from('user_qr_codes')
        .select('*')
        .eq('email', userCode)
        .limit(1)
        .single();

      if (!error && data) {
        const guests = (data.guests || []).map(g => ({ ...g, isEditing: false, editName: '' }));
        return {
          totalGuests: data.total_guests || guests.reduce((s, gg) => s + (gg.maxGuests || 0), 0),
          attendedGuests: data.attended_guests || guests.reduce((s, gg) => s + (gg.attended || 0), 0),
          guestsList: guests
        };
      }
    } catch (_) { /* تجاهل */ }

    // fallback: event_history
    try {
      const { data, error } = await supabase
        .from('event_history')
        .select('*')
        .eq('email', userCode)
        .order('ended_at', { ascending: false })
        .limit(1)
        .single();

      if (!error && data) {
        const guests = (data.guests || []).map(g => ({ ...g, isEditing: false, editName: '' }));
        return {
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
    } catch (e) {
      // قد لا يكون الجدول موجود
    }
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

  // ===== حفظ تلقائي — لكن فقط إذا عندنا بيانات فعلية (لا تنشئ صفوف فارغة) =====
  useEffect(() => {
    const persist = async () => {
      if (!userData?.userCode) return;
      if (storeData.guestsList.length === 0 && storeData.attendedGuests === 0 && storeData.totalGuests === 0) {
        // لا تحفظ حالة فارغة
        return;
      }
      // احفظ بالسيرفر؛ لو فشل، خزّن محلي
      const ok = await supabaseUpsert(userData.userCode, storeData);
      if (!ok) saveLocal(userData.userCode, storeData);
    };
    persist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeData]);

  // ===== دخول تلقائي على آخر مستخدم (بدون توليد أي شيء تلقائي) =====
  useEffect(() => {
    const init = async () => {
      try {
        setIsAuthenticated(true);
        const lastCode = typeof window !== 'undefined' ? localStorage.getItem(LAST_USER_KEY) : null;
        if (lastCode) {
          // حاول اللوود من قاعدة البيانات أولاً
          const fromDb = await supabaseLoad(lastCode);
          if (fromDb) {
            setUserData({ userCode: lastCode, createdAt: new Date().toISOString() });
            setStoreData(fromDb);
            setCurrentView('organizer');
            return;
          }
          // وإلا جرّب المحلي
          const fromLocal = loadLocal(lastCode);
          if (fromLocal) {
            setUserData({ userCode: lastCode, createdAt: new Date().toISOString() });
            setStoreData({
              totalGuests: fromLocal.totalGuests || 0,
              attendedGuests: fromLocal.attendedGuests || 0,
              guestsList: fromLocal.guestsList || [],
            });
            setCurrentView('organizer');
            return;
          }
          // لا تنشئ أي شيء — خليها واجهة المنظمة الفارغة
          setUserData({ userCode: lastCode, createdAt: new Date().toISOString() });
          setStoreData({ totalGuests: 0, attendedGuests: 0, guestsList: [] });
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
  }, []);

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

        // حمّل من DB، وإذا ماكو من Local، وإذا ماكو خليه فارغ
        const fromDb = await supabaseLoad(userCode);
        const fromLocal = !fromDb ? loadLocal(userCode) : null;

        setUserData({ userCode, createdAt: new Date().toISOString() });
        setStoreData(
          fromDb || fromLocal || { totalGuests: 0, attendedGuests: 0, guestsList: [] }
        );
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

  // ===== توليد وإلحاق رموز (فقط عند الضغط) =====
  const appendQRCodes = async (numberOfCodes, guestsPerCode) => {
    if (!userData?.userCode) return;

    const newGuests = [];
    for (let i = 1; i <= numberOfCodes; i++) {
      const seq = storeData.guestsList.length + i;
      const groupId = `GROUP_${seq}_${Math.random().toString(36).substr(2, 6)}`;
      const qrData = generateQRData(userData.userCode, groupId, guestsPerCode);
      const link = `${window.location.origin}?qr=${encodeURIComponent(qrData)}`;
      const qrImageUrl = await generateQRCode(link);
      newGuests.push({
        id: groupId,
        name: `مجموعة ${seq}`,
        attended: 0,
        maxGuests: guestsPerCode,
        qrCode: qrData,
        qrImageUrl,
        isEditing: false,
        editName: ''
      });
    }

    setStoreData(prev => ({
      ...prev,
      totalGuests: prev.totalGuests + (numberOfCodes * guestsPerCode),
      guestsList: [...prev.guestsList, ...newGuests]
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

  // ===== مسح QR =====
  const handleScan = (data) => {
    if (!data) return;
    setScanResult('جاري التحقق من الرمز...');

    const group = storeData.guestsList.find(g => g.qrCode === data);
    if (group) {
      if (group.attended < group.maxGuests) {
        const updatedGuests = storeData.guestsList.map(g =>
          g.id === group.id ? { ...g, attended: g.attended + 1 } : g
        );
        setStoreData(prev => ({
          ...prev,
          guestsList: updatedGuests,
          attendedGuests: prev.attendedGuests + 1
        }));
        setScanResult(`تم تسجيل حضور ضيف من ${group.name}! (${group.attended + 1}/${group.maxGuests})`);
      } else {
        setScanResult(`تم بلوغ الحد الأقصى لهذه المجموعة (${group.maxGuests}).`);
      }
    } else {
      setScanResult('QR Code غير صالح');
    }
  };

  // ===== معالجة الروابط مع qr =====
  useEffect(() => {
    if (!userData) return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get('qr');
    if (code) {
      handleScan(code);
      params.delete('qr');
      const newQuery = params.toString();
      window.history.replaceState({}, '', `${window.location.pathname}${newQuery ? '?' + newQuery : ''}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userData, storeData]);

  // ===== إعادة تعيين (يمسح كل شيء من قاعدة البيانات) =====
  const resetSystem = async () => {
    if (!userData?.userCode) return;
    const confirmReset = window.confirm('هل أنت متأكد من حذف كل بياناتك من قاعدة البيانات؟ الإجراء لا يمكن التراجع عنه.');
    if (!confirmReset) return;

    try {
      // احذف من Supabase (الجدول الأساسي + fallback)
      await supabaseDeleteAll(userData.userCode);
      // نظف المحلي
      clearLocal(userData.userCode);

      // امسح الحالة الحالية
      setStoreData({ totalGuests: 0, attendedGuests: 0, guestsList: [] });
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
    setStoreData({ totalGuests: 0, attendedGuests: 0, guestsList: [] });
    setIsAuthenticated(false);
    setCurrentView('login');
  };

  // ===== واجهة المنظم =====
  const OrganizerView = () => {
    const [newCodesCount, setNewCodesCount] = useState(5);
    const [newGuestsPerCode, setNewGuestsPerCode] = useState(2);
    const [isGenerating, setIsGenerating] = useState(false);

    const handleAppend = async () => {
      setIsGenerating(true);
      await appendQRCodes(newCodesCount, newGuestsPerCode);
      setIsGenerating(false);
      setShowAppendPanel(false);
    };

    const attendancePercent = storeData.totalGuests > 0
      ? Math.round((storeData.attendedGuests / storeData.totalGuests) * 100)
      : 0;

    return (
      <div className="space-y-6">
        <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white p-6 rounded-lg">
          <h2 className="text-2xl font-bold mb-2">مرحباً {userData.userCode}</h2>
          <p className="opacity-90">لوحة تحكم المنظّم {isAuthenticated ? ' (متصل بقاعدة البيانات)' : ' (تخزين محلي)'} </p>
        </div>

        {/* إحصائيات */}
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

        {/* شريط تقدم */}
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
                إضافة رموز جديدة
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
              استخدم كاميرا هاتفك لمسح رمز QR؛ سيفتح الرابط ويسجل الحضور تلقائياً.
            </p>

            <button
              onClick={handleLogout}
              className="px-4 py-2 rounded-md border border-gray-300 hover:bg-gray-50 transition-colors"
            >
              تسجيل الخروج
            </button>
          </div>

          {/* لوحة الإلحاق */}
          {showAppendPanel && (
            <div className="mt-4 border rounded-lg p-4 bg-indigo-50">
              <h5 className="font-semibold mb-3">إضافة رموز جديدة إلى القائمة الحالية</h5>
              <AppendPanel onAppend={handleAppend} />
            </div>
          )}
        </div>

        {/* حالة فارغة */}
        {storeData.guestsList.length === 0 && (
          <div className="bg-white p-6 rounded-lg border text-center">
            <h4 className="text-lg font-semibold mb-2">لا توجد رموز QR بعد</h4>
            <p className="text-gray-600 mb-4">اضغط "إضافة رموز جديدة" لإنشاء الرموز وربطها بحسابك في قاعدة البيانات.</p>
            <button
              onClick={() => setShowAppendPanel(true)}
              className="inline-flex items-center gap-2 px-5 py-3 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
            >
              <PlusCircle className="w-5 h-5" />
              إنشاء أول مجموعة
            </button>
          </div>
        )}

        {/* قائمة الرموز */}
        {storeData.guestsList.length > 0 && (
          <div className="bg-white p-4 sm:p-6 rounded-lg shadow-md border">
            <h4 className="text-lg font-semibold mb-4">المجموعات / الرموز</h4>

            {scanResult && <div className="mb-4 p-3 rounded-md border text-sm bg-gray-50">{scanResult}</div>}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {storeData.guestsList.map((g) => (
                <div key={g.id} className="border rounded-lg p-3">
                  <div className="flex items-center justify-between mb-3">
                    {g.isEditing ? (
                      <input
                        type="text"
                        value={g.editName}
                        onChange={(e) => {
                          const val = e.target.value;
                          setStoreData((prev) => ({
                            ...prev,
                            guestsList: prev.guestsList.map((x) =>
                              x.id === g.id ? { ...x, editName: val } : x
                            ),
                          }));
                        }}
                        className="w-full mr-2 p-2 border rounded"
                        placeholder="اسم المجموعة"
                      />
                    ) : (
                      <h5 className="font-medium truncate">👥 {g.name}</h5>
                    )}

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
                          className="p-2 rounded-md border hover:bg-gray-50"
                          title="تعديل الاسم"
                        >
                          <Settings className="w-4 h-4" />
                        </button>
                      ) : (
                        <>
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
                        </>
                      )}
                    </div>
                  </div>

                  <div className="text-sm text-gray-600 mb-3">
                    الحضور: <span className="font-semibold">{g.attended}</span> / {g.maxGuests}
                  </div>

                  {g.qrImageUrl ? (
                    <div className="bg-gray-50 rounded-md p-3 flex flex-col items-center gap-3">
                      <img src={g.qrImageUrl} alt={g.name} className="w-40 h-40 object-contain" loading="lazy" />
                      <button
                        onClick={() => downloadQRCode(g)}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-gray-800 text-white hover:bg-black transition-colors text-sm"
                      >
                        <Download className="w-4 h-4" />
                        تحميل QR
                      </button>
                    </div>
                  ) : (
                    <div className="text-xs text-gray-500">لا توجد صورة QR</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    );
  };

  // لوحة إدخال القيم لعملية الإلحاق
  const AppendPanel = ({ onAppend }) => {
    const [count, setCount] = useState(5);
    const [perCode, setPerCode] = useState(2);
    const [busy, setBusy] = useState(false);

    const handle = async () => {
      if (busy) return;
      setBusy(true);
      await onAppend();
      setBusy(false);
    };

    return (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-sm font-medium mb-2">عدد الرموز الجديدة</label>
          <input
            type="number"
            value={count}
            onChange={(e) => setCount(parseInt(e.target.value) || 0)}
            className="w-full p-3 border border-gray-300 rounded-md text-center"
            min="1"
            max="100"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">عدد الضيوف لكل رمز</label>
          <input
            type="number"
            value={perCode}
            onChange={(e) => setPerCode(parseInt(e.target.value) || 0)}
            className="w-full p-3 border border-gray-300 rounded-md text-center"
            min="1"
            max="20"
          />
        </div>
        <div className="flex items-end">
          <button
            onClick={async () => {
              if (count <= 0 || perCode <= 0) return;
              setBusy(true);
              await appendQRCodes(count, perCode);
              setBusy(false);
            }}
            disabled={busy || count <= 0 || perCode <= 0}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-50"
          >
            {busy ? 'جاري الإضافة...' : 'إضافة الآن'}
          </button>
        </div>
      </div>
    );
  };

  // ===== العرض =====
  return currentView === 'login' ? <LoginForm /> : (
    <div className="min-h-screen bg-gray-50" dir="rtl">
      <div className="max-w-6xl mx-auto p-4 sm:p-6">
        <OrganizerView />
      </div>
    </div>
  );
};

export default QRAttendanceSystem;
