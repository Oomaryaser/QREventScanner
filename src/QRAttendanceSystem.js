import React, { useState, useEffect } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { QrCode, Users, Scan, CheckCircle, UserPlus, RotateCcw, Settings, Download } from 'lucide-react';
import { supabase } from './supabaseClient';

// محاكاة عميل Supabase للعرض التوضيحي
// مولد QR Code حقيقي
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

const generateQRData = (guestId, eventId, guestCount) => {
  return `EVENT:${eventId}|GUEST:${guestId}|COUNT:${guestCount}|TIME:${Date.now()}`;
};

const QRAttendanceSystem = () => {
  const [currentView, setCurrentView] = useState('login');
  const [userData, setUserData] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [eventData, setEventData] = useState({
    eventId: '',
    totalGuests: 0,
    attendedGuests: 0,
    guestsList: [],
    qrCodes: []
  });
  const [scanResult, setScanResult] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [showScanner, setShowScanner] = useState(false);

  // التحقق من المصادقة عند بدء التطبيق
  useEffect(() => {
    checkAuthStatus();
  }, []);

  const checkAuthStatus = async () => {
  try {
    // تجاهل فحص المصادقة - اعتبار المستخدم مصادق دائماً
    setIsAuthenticated(true);
  } catch (error) {
    console.error('خطأ في التحقق من المصادقة:', error);
  }
};

 const authenticateUser = async (userCode) => {
  try {
    // إزالة المصادقة - استخدام البيانات مباشرة
    setIsAuthenticated(true);
    return true;
  } catch (error) {
    console.error('خطأ في المصادقة:', error);
    return false;
  }
};

  // حفظ واسترجاع البيانات من localStorage كبديل مؤقت
  const saveUserDataLocally = (userCode, { userData, eventData }) => {
    try {
      const dataToSave = {
        userData,
        eventData,
        timestamp: new Date().toISOString()
      };
      localStorage.setItem(`qr_attendance_${userCode}`, JSON.stringify(dataToSave));
      console.log('تم حفظ البيانات محلياً');
    } catch (error) {
      console.error('خطأ في حفظ البيانات محلياً:', error);
    }
  };

  const loadUserDataLocally = (userCode) => {
    try {
      const savedData = localStorage.getItem(`qr_attendance_${userCode}`);
      if (savedData) {
        const parsedData = JSON.parse(savedData);
        return {
          userData: parsedData.userData,
          eventData: {
            ...parsedData.eventData,
            guestsList: parsedData.eventData.guestsList.map(g => ({
              ...g,
              isEditing: false,
              editName: ''
            }))
          }
        };
      }
      return null;
    } catch (error) {
      console.error('خطأ في جلب البيانات محلياً:', error);
      return null;
    }
  };

  // حفظ واسترجاع البيانات من Supabase (مع fallback للتخزين المحلي)
  const saveUserData = async (userCode, { userData, eventData }) => {
    try {
      if (isAuthenticated) {
        const { error } = await supabase
          .from('event_history')
          .upsert(
            {
              email: userCode,
              event_name: eventData.eventId,
              event_id: eventData.eventId,
              total_guests: eventData.totalGuests,
              attended_guests: eventData.attendedGuests,
              guests: eventData.guestsList.map(g => ({
                id: g.id,
                name: g.name,
                attended: g.attended,
                maxGuests: g.maxGuests,
                qrCode: g.qrCode,
                qrImageUrl: g.qrImageUrl
              })),
              ended_at: new Date().toISOString()
            },
            { onConflict: 'email,event_id' }
          );
        
        if (error) {
          console.error('خطأ في حفظ البيانات في Supabase:', error);
          // fallback للتخزين المحلي
          saveUserDataLocally(userCode, { userData, eventData });
        } else {
          console.log('تم حفظ البيانات في Supabase بنجاح');
        }
      } else {
        // استخدام التخزين المحلي كبديل
        saveUserDataLocally(userCode, { userData, eventData });
      }
    } catch (error) {
      console.error('خطأ عام في حفظ البيانات:', error);
      // fallback للتخزين المحلي
      saveUserDataLocally(userCode, { userData, eventData });
    }
  };

  const loadUserData = async (userCode) => {
    try {
      if (isAuthenticated) {
        const { data, error } = await supabase
          .from('event_history')
          .select('*')
          .eq('email', userCode)
          .order('ended_at', { ascending: false })
          .limit(1)
          .single();

        if (!error && data) {
          const guests = (data.guests || []).map(g => ({
            ...g,
            isEditing: false,
            editName: ''
          }));
          return {
            userData: { userCode },
            eventData: {
              eventId: data.event_id,
              totalGuests: data.total_guests,
              attendedGuests: data.attended_guests,
              guestsList: guests,
              qrCodes: guests.map(g => g.qrCode)
            }
          };
        }
      }
      
      // fallback للتخزين المحلي
      return loadUserDataLocally(userCode);
    } catch (error) {
      console.error('خطأ في جلب البيانات:', error);
      // fallback للتخزين المحلي
      return loadUserDataLocally(userCode);
    }
  };

  // حفظ البيانات تلقائياً عند تغييرها
  useEffect(() => {
    const persist = async () => {
      if (userData && eventData.eventId) {
        await saveUserData(userData.userCode, { userData, eventData });
      }
    };
    persist();
  }, [userData, eventData]);

  // تسجيل دخول بسيط
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
        // محاولة المصادقة
        const authSuccess = await authenticateUser(userCode);
        
        if (!authSuccess && !localStorage.getItem(`qr_attendance_${userCode}`)) {
          setError('فشل في المصادقة. سيتم استخدام التخزين المحلي.');
        }

        const savedData = await loadUserData(userCode);

        if (savedData) {
          // تسجيل دخول لمستخدم موجود
          setUserData(savedData.userData);
          setEventData(savedData.eventData);
          setCurrentView('organizer');
        } else {
          // إنشاء مستخدم جديد
          const newUserData = {
            userCode: userCode,
            createdAt: new Date().toISOString()
          };
          const newEventData = {
            eventId: 'EVENT_' + Math.random().toString(36).substr(2, 9),
            totalGuests: 0,
            attendedGuests: 0,
            guestsList: [],
            qrCodes: []
          };
          setUserData(newUserData);
          setEventData(newEventData);
          setCurrentView('organizer');
        }
      } catch (error) {
        setError('حدث خطأ أثناء تسجيل الدخول');
        console.error('خطأ في تسجيل الدخول:', error);
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
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-800 p-3 rounded-md text-sm">
                {error}
              </div>
            )}

            {!isAuthenticated && (
              <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 p-3 rounded-md text-sm">
                ملاحظة: سيتم استخدام التخزين المحلي في حالة عدم توفر الاتصال بقاعدة البيانات
              </div>
            )}
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                رمز المستخدم
              </label>
              <input
                type="text"
                value={userCode}
                onChange={(e) => setUserCode(e.target.value)}
                className="w-full p-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="أدخل رمز المستخدم..."
                required
                disabled={isLoading}
              />
              <p className="text-xs text-gray-500 mt-1">
                يمكنك استخدام أي رمز تريده (مثل: احمد123، حفلة_العيد، إلخ)
              </p>
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
              ) : (
                'دخول'
              )}
            </button>
          </form>
          
          <div className="mt-6 p-4 bg-blue-50 rounded-md">
            <p className="text-sm text-blue-800">
              <strong>للمستخدمين الجدد:</strong> أدخل أي رمز تريده وسيتم إنشاء حساب جديد
            </p>
            <p className="text-sm text-blue-800 mt-2">
              <strong>للمستخدمين الحاليين:</strong> أدخل الرمز نفسه لاسترجاع بياناتك
            </p>
          </div>
        </div>
      </div>
    );
  };

  // باقي الكود يبقى كما هو...
  // توليد QR codes للضيوف
  const generateQRCodes = async (numberOfCodes, guestsPerCode) => {
    const newGuests = [];
    const newQRCodes = [];
    
    for (let i = 1; i <= numberOfCodes; i++) {
      const guestId = `GROUP_${i}_${Math.random().toString(36).substr(2, 6)}`;
      const qrData = generateQRData(guestId, eventData.eventId, guestsPerCode);
      
      const qrImageUrl = await generateQRCode(qrData);
      
      newGuests.push({
        id: guestId,
        name: `مجموعة ${i}`,
        attended: 0,
        maxGuests: guestsPerCode,
        qrCode: qrData,
        qrImageUrl: qrImageUrl,
        isEditing: false,
        editName: ''
      });
      
      newQRCodes.push(qrData);
    }
    
    setEventData(prev => ({
      ...prev,
      totalGuests: numberOfCodes * guestsPerCode,
      guestsList: newGuests,
      qrCodes: newQRCodes,
      attendedGuests: 0
    }));
  };

  // تحميل QR Code كصورة
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

  // تحميل جميع QR Codes
  const downloadAllQRCodes = async () => {
    for (const guest of eventData.guestsList) {
      await downloadQRCode(guest);
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  };

  // معالجة مسح QR Code
  const handleScan = (data) => {
    if (data) {
      setIsScanning(true);
      setScanResult('جاري التحقق من الرمز...');
      
      const group = eventData.guestsList.find(g => g.qrCode === data);
      
      if (group) {
        if (group.attended < group.maxGuests) {
          const updatedGuests = eventData.guestsList.map(g => 
            g.id === group.id ? { ...g, attended: g.attended + 1 } : g
          );
          
          setEventData(prev => ({
            ...prev,
            guestsList: updatedGuests,
            attendedGuests: prev.attendedGuests + 1
          }));
          
          setScanResult(`تم تسجيل حضور ضيف من ${group.name} بنجاح! (${group.attended + 1}/${group.maxGuests})`);
        } else {
          setScanResult(`تم تسجيل الحد الأقصى من الضيوف لهذه المجموعة (${group.maxGuests} ضيوف)`);
        }
      } else {
        setScanResult('QR Code غير صالح');
      }
      
      setIsScanning(false);
      setTimeout(() => setShowScanner(false), 2000);
    }
  };

  const handleError = (error) => {
    console.error(error);
    setScanResult('حدث خطأ في الكاميرا');
  };

  // إعادة تعيين النظام
  const resetSystem = () => {
    const confirmReset = window.confirm('هل أنت متأكد من إعادة تعيين جميع البيانات؟');
    if (confirmReset) {
      setEventData({
        eventId: 'EVENT_' + Math.random().toString(36).substr(2, 9),
        totalGuests: 0,
        attendedGuests: 0,
        guestsList: [],
        qrCodes: []
      });
      setScanResult('');
      setShowScanner(false);
    }
  };

  const handleLogout = () => {
    const confirmLogout = window.confirm('هل تريد تسجيل الخروج؟');
    if (confirmLogout) {
      setUserData(null);
      setEventData({
        eventId: '',
        totalGuests: 0,
        attendedGuests: 0,
        guestsList: [],
        qrCodes: []
      });
      setIsAuthenticated(false);
      setCurrentView('login');
    }
  };

  // واجهة منظم الحفلة
  const OrganizerView = () => {
    const [totalCodes, setTotalCodes] = useState(5);
    const [guestsPerCode, setGuestsPerCode] = useState(2);
    const [isGenerating, setIsGenerating] = useState(false);
    
    const handleGenerateQRCodes = async () => {
      setIsGenerating(true);
      await generateQRCodes(totalCodes, guestsPerCode);
      setIsGenerating(false);
    };

    return (
      <div className="space-y-6">
        <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white p-6 rounded-lg">
          <h2 className="text-2xl font-bold mb-2">مرحباً {userData.userCode}</h2>
          <p className="opacity-90">
            لوحة تحكم منظم الحفلة 
            {isAuthenticated ? " (متصل بقاعدة البيانات)" : " (تخزين محلي)"}
          </p>
        </div>
        
        {eventData.totalGuests === 0 ? (
          <div className="bg-white p-4 sm:p-6 rounded-lg shadow-md border">
            <div className="text-center space-y-3 sm:space-y-4">
              <QrCode className="w-12 h-12 sm:w-16 sm:h-16 mx-auto text-blue-500" />
              <h3 className="text-lg sm:text-xl font-semibold">إنشاء رموز QR للضيوف</h3>
              <div className="space-y-3 sm:space-y-4">
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">عدد رموز QR المطلوبة</label>
                    <input
                      type="number"
                      value={totalCodes}
                      onChange={(e) => setTotalCodes(parseInt(e.target.value) || 0)}
                      className="w-full p-3 border border-gray-300 rounded-md text-center text-lg"
                      min="1"
                      max="50"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">عدد الضيوف لكل رمز QR</label>
                    <input
                      type="number"
                      value={guestsPerCode}
                      onChange={(e) => setGuestsPerCode(parseInt(e.target.value) || 0)}
                      className="w-full p-3 border border-gray-300 rounded-md text-center text-lg"
                      min="1"
                      max="10"
                    />
                  </div>
                  <div className="bg-blue-50 p-4 rounded-md">
                    <p className="text-blue-800">إجمالي عدد الضيوف: {totalCodes * guestsPerCode}</p>
                  </div>
                </div>
                <button
                  onClick={handleGenerateQRCodes}
                  disabled={isGenerating}
                  className="bg-blue-600 text-white px-6 py-3 rounded-md hover:bg-blue-700 transition-colors flex items-center gap-2 mx-auto disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isGenerating ? (
                    <>
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                      جاري الإنشاء...
                    </>
                  ) : (
                    <>
                      <UserPlus className="w-5 h-5" />
                      إنشاء رموز QR
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* إحصائيات الحضور */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
              <div className="bg-blue-50 p-3 sm:p-4 rounded-lg border border-blue-200">
                <div className="flex items-center gap-2 sm:gap-3">
                  <Users className="w-8 h-8 text-blue-600" />
                  <div>
                    <p className="text-sm text-blue-600">إجمالي الضيوف</p>
                    <p className="text-2xl font-bold text-blue-800">{eventData.totalGuests}</p>
                  </div>
                </div>
              </div>
              
              <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                <div className="flex items-center gap-3">
                  <CheckCircle className="w-8 h-8 text-green-600" />
                  <div>
                    <p className="text-sm text-green-600">حضر فعلاً</p>
                    <p className="text-2xl font-bold text-green-800">{eventData.attendedGuests}</p>
                  </div>
                </div>
              </div>
              
              <div className="bg-orange-50 p-4 rounded-lg border border-orange-200">
                <div className="flex items-center gap-3">
                  <Users className="w-8 h-8 text-orange-600" />
                  <div>
                    <p className="text-sm text-orange-600">لم يحضر بعد</p>
                    <p className="text-2xl font-bold text-orange-800">{eventData.totalGuests - eventData.attendedGuests}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* شريط التقدم */}
            <div className="bg-white p-4 rounded-lg shadow-md border">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium">نسبة الحضور</span>
                <span className="text-sm text-gray-500">
                  {Math.round((eventData.attendedGuests / eventData.totalGuests) * 100)}%
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3">
                <div 
                  className="bg-gradient-to-r from-green-500 to-blue-500 h-3 rounded-full transition-all duration-500"
                  style={{ width: `${(eventData.attendedGuests / eventData.totalGuests) * 100}%` }}
                ></div>
              </div>
            </div>

            {/* أزرار التحميل */}
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
                    onClick={() => setShowScanner(true)}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                  >
                    <Scan className="w-4 h-4" />
                    بدء المسح بالكاميرا
                  </button>

                  <button
                    onClick={resetSystem}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-red-600 text-white hover:bg-red-700 transition-colors"
                  >
                    <RotateCcw className="w-4 h-4" />
                    إعادة التعيين
                  </button>
                </div>

                <button
                  onClick={handleLogout}
                  className="px-4 py-2 rounded-md border border-gray-300 hover:bg-gray-50 transition-colors"
                >
                  تسجيل الخروج
                </button>
              </div>
            </div>

            {/* قائمة المجموعات و الـ QR Codes */}
            <div className="bg-white p-4 sm:p-6 rounded-lg shadow-md border">
              <h4 className="text-lg font-semibold mb-4">المجموعات / الرموز</h4>

              {scanResult && (
                <div className="mb-4 p-3 rounded-md border text-sm bg-gray-50">
                  {scanResult}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {eventData.guestsList.map((g, idx) => (
                  <div key={g.id} className="border rounded-lg p-3">
                    <div className="flex items-center justify-between mb-3">
                      {g.isEditing ? (
                        <input
                          type="text"
                          value={g.editName}
                          onChange={(e) => {
                            const val = e.target.value;
                            setEventData((prev) => ({
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
                              setEventData((prev) => ({
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
                                setEventData((prev) => ({
                                  ...prev,
                                  guestsList: prev.guestsList.map((x) =>
                                    x.id === g.id
                                      ? { ...x, name: x.editName || g.name, isEditing: false }
                                      : x
                                  ),
                                }));
                              }}
                              className="px-2 py-1 rounded-md bg-green-600 text-white text-sm"
                            >
                              حفظ
                            </button>
                            <button
                              onClick={() =>
                                setEventData((prev) => ({
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
                        <img
                          src={g.qrImageUrl}
                          alt={g.name}
                          className="w-40 h-40 object-contain"
                          loading="lazy"
                        />
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

            {/* نافذة الماسح بالكاميرا */}
            {showScanner && (
              <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                <div className="bg-white w-full max-w-lg rounded-lg shadow-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h5 className="font-semibold">المسح بالكاميرا</h5>
                    <button
                      onClick={() => setShowScanner(false)}
                      className="px-3 py-1 rounded-md border hover:bg-gray-50"
                    >
                      إغلاق
                    </button>
                  </div>
                  <div id="qr-scanner" className="w-full" />
                  <p className="mt-3 text-sm text-gray-600">
                    وجّه الكود نحو الكاميرا لتسجيل الحضور تلقائياً.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // تهيئة الماسح عند فتح النافذة
  useEffect(() => {
    let scannerInstance = null;

    if (showScanner) {
      try {
        const config = {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          rememberLastUsedCamera: true,
        };
        scannerInstance = new Html5QrcodeScanner('qr-scanner', config, false);
        scannerInstance.render(
          (decodedText) => handleScan(decodedText),
          (err) => handleError(err)
        );
      } catch (e) {
        console.error('فشل إنشاء الماسح:', e);
        setScanResult('تعذر تشغيل الكاميرا. تحقق من الأذونات.');
      }
    }

    return () => {
      if (scannerInstance) {
        try {
          scannerInstance.clear();
        } catch (_) {}
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showScanner]);

  // الواجهة الرئيسية للتبديل بين تسجيل الدخول ولوحة المنظم
  return currentView === 'login' ? <LoginForm /> : (
    <div className="min-h-screen bg-gray-50" dir="rtl">
      <div className="max-w-6xl mx-auto p-4 sm:p-6">
        <OrganizerView />
      </div>
    </div>
  );
};

export default QRAttendanceSystem;
