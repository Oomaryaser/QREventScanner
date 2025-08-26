import React, { useState, useEffect } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { QrCode, Users, Scan, CheckCircle, UserPlus, RotateCcw, Settings, Download } from 'lucide-react';

// مولد QR Code حقيقي
const generateQRCode = async (data, size = 200) => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  // استخدام QR Code API
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(data)}&format=png`;
  
  try {
    const response = await fetch(qrUrl);
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  } catch (error) {
    console.error('خطأ في توليد QR Code:', error);
    return null;
  }
};

const generateQRData = (guestId, eventId, guestCount) => {
  return `EVENT:${eventId}|GUEST:${guestId}|COUNT:${guestCount}|TIME:${Date.now()}`;
};

const QRAttendanceSystem = () => {
  const [currentView, setCurrentView] = useState('organizer');
  const [eventData, setEventData] = useState({
    eventId: 'EVENT_' + Math.random().toString(36).substr(2, 9),
    totalGuests: 0,
    attendedGuests: 0,
    guestsList: [],
    qrCodes: []
  });
  const [scanResult, setScanResult] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [showScanner, setShowScanner] = useState(false);

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
        attended: 0, // عدد الضيوف الذين حضروا من هذه المجموعة
        maxGuests: guestsPerCode, // العدد الأقصى للضيوف في هذه المجموعة
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
    setEventData({
      eventId: 'EVENT_' + Math.random().toString(36).substr(2, 9),
      totalGuests: 0,
      attendedGuests: 0,
      guestsList: [],
      qrCodes: []
    });
    setScanResult('');
    setShowScanner(false);
  };

  // واجهة منظم الحفلة
  const OrganizerView = () => {
  const [totalCodes, setTotalCodes] = useState(5); // عدد رموز QR
  const [guestsPerCode, setGuestsPerCode] = useState(2); // عدد الضيوف لكل رمز
  const [isGenerating, setIsGenerating] = useState(false);
  
  const handleGenerateQRCodes = async () => {
    setIsGenerating(true);
    await generateQRCodes(totalCodes, guestsPerCode);
    setIsGenerating(false);
  };    return (
      <div className="space-y-6">
        <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white p-6 rounded-lg">
          <h2 className="text-2xl font-bold mb-2">لوحة تحكم منظم الحفلة</h2>
          <p className="opacity-90">إنشاء وإدارة رموز QR للضيوف</p>
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
            <div className="bg-white p-3 sm:p-4 rounded-lg shadow-md border">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-3 gap-2 sm:gap-0">
                <h3 className="text-base sm:text-lg font-semibold">رموز QR</h3>
                <button
                  onClick={downloadAllQRCodes}
                  className="w-full sm:w-auto bg-green-600 text-white px-3 sm:px-4 py-2 rounded-md hover:bg-green-700 transition-colors flex items-center justify-center sm:justify-start gap-2 text-xs sm:text-sm"
                >
                  <Download className="w-4 h-4" />
                  تحميل الكل
                </button>
              </div>
              <p className="text-sm text-gray-600 mb-4">يمكنك تحميل رموز QR لطباعتها وتوزيعها على الضيوف</p>
              
              {/* معاينة QR Codes */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 max-h-[calc(100vh-300px)] overflow-y-auto p-1">
                {eventData.guestsList.map((guest, index) => (
                  <div key={guest.id} className="bg-gray-50 p-3 sm:p-4 rounded-md border text-center">
                    {guest.qrImageUrl ? (
                      <img 
                        src={guest.qrImageUrl} 
                        alt={`QR Code for ${guest.name}`}
                        className="w-full h-32 object-contain mb-3"
                      />
                    ) : (
                      <div className="w-full h-32 bg-gray-200 rounded flex items-center justify-center mb-3">
                        <QrCode className="w-12 h-12 text-gray-400" />
                      </div>
                    )}
                    <div className="space-y-3">
                      <div className="relative group">
                        {guest.isEditing ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={guest.editName || guest.name}
                              onChange={(e) => {
                                const updatedGuests = eventData.guestsList.map(g =>
                                  g.id === guest.id ? { ...g, editName: e.target.value } : g
                                );
                                setEventData(prev => ({
                                  ...prev,
                                  guestsList: updatedGuests
                                }));
                              }}
                              className="w-full p-2 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  const updatedGuests = eventData.guestsList.map(g =>
                                    g.id === guest.id ? { ...g, name: g.editName || g.name, isEditing: false, editName: '' } : g
                                  );
                                  setEventData(prev => ({
                                    ...prev,
                                    guestsList: updatedGuests
                                  }));
                                }
                              }}
                            />
                            <button
                              onClick={() => {
                                const updatedGuests = eventData.guestsList.map(g =>
                                  g.id === guest.id ? { ...g, name: g.editName || g.name, isEditing: false, editName: '' } : g
                                );
                                setEventData(prev => ({
                                  ...prev,
                                  guestsList: updatedGuests
                                }));
                              }}
                              className="p-2 text-green-600 hover:text-green-800"
                            >
                              ✓
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center">
                            <p className="text-sm font-medium">{guest.name}</p>
                            <button
                              onClick={() => {
                                const updatedGuests = eventData.guestsList.map(g =>
                                  g.id === guest.id ? { ...g, isEditing: true, editName: g.name } : g
                                );
                                setEventData(prev => ({
                                  ...prev,
                                  guestsList: updatedGuests
                                }));
                              }}
                              className="opacity-0 group-hover:opacity-100 mr-2 p-1 text-blue-600 hover:text-blue-800"
                            >
                              ✎
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col gap-2">
                        <button
                          onClick={() => downloadQRCode(guest)}
                          className="bg-blue-500 text-white text-xs px-3 py-2 rounded hover:bg-blue-600 transition-colors flex items-center gap-1 justify-center w-full"
                        >
                          <Download className="w-3 h-3" />
                          تحميل
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* قائمة الضيوف */}
            <div className="bg-white rounded-lg shadow-md border">
              <div className="p-3 sm:p-4 border-b">
                <h3 className="text-base sm:text-lg font-semibold">قائمة الضيوف</h3>
                <p className="text-xs sm:text-sm text-gray-500 mt-1">اضغط على اسم المجموعة لتعديله</p>
              </div>
              <div className="max-h-60 overflow-y-auto">
                {eventData.guestsList.map((guest, index) => (
                  <div key={guest.id} className="flex items-center justify-between p-3 border-b border-gray-100 hover:bg-gray-50">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-semibold text-sm">
                        {index + 1}
                      </div>
                      <div>
                        <span className="font-medium">{guest.name}</span>
                        <p className="text-xs text-gray-500">{guest.maxGuests} ضيوف</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-1 rounded-full flex items-center gap-1 ${
                          guest.attended === guest.maxGuests 
                            ? 'bg-green-100 text-green-800'
                            : guest.attended > 0
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-orange-100 text-orange-800'
                        }`}>
                          {guest.attended === guest.maxGuests && <CheckCircle className="w-3 h-3" />}
                          {guest.attended} / {guest.maxGuests} ضيوف
                        </span>
                      </div>
                      <button
                        onClick={() => downloadQRCode(guest)}
                        className="text-blue-600 hover:bg-blue-50 p-1 rounded text-xs"
                        title="تحميل QR Code"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* أزرار التحكم */}
            <div className="flex gap-3">
              <button
                onClick={resetSystem}
                className="flex-1 bg-red-600 text-white px-4 py-3 rounded-md hover:bg-red-700 transition-colors flex items-center justify-center gap-2"
              >
                <RotateCcw className="w-5 h-5" />
                إعادة تعيين
              </button>
            </div>

            {/* رسالة إكمال الحضور */}
            {eventData.attendedGuests === eventData.totalGuests && eventData.totalGuests > 0 && (
              <div className="bg-green-50 border border-green-200 p-6 rounded-lg text-center">
                <CheckCircle className="w-16 h-16 mx-auto text-green-600 mb-4" />
                <h3 className="text-xl font-bold text-green-800 mb-2">تم حضور جميع الضيوف!</h3>
                <p className="text-green-600">حضر جميع الضيوف المدعوين بنجاح</p>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // واجهة الضيف
  const GuestView = () => {
    useEffect(() => {
      if (showScanner) {
        const scanner = new Html5QrcodeScanner("qr-reader", { 
          fps: 10,
          qrbox: {
            width: Math.min(250, window.innerWidth - 50),
            height: Math.min(250, window.innerWidth - 50)
          },
          aspectRatio: 1,
          rememberLastUsedCamera: true
        });
        
        scanner.render((decodedText) => {
          handleScan(decodedText);
        }, (error) => {
          handleError(error);
        });
        
        return () => {
          try {
            scanner.clear();
          } catch (error) {
            console.error('Error clearing scanner:', error);
          }
        };
      }
    }, [showScanner, handleScan, handleError]);
    return (
      <div className="space-y-6">
        <div className="bg-gradient-to-r from-green-600 to-teal-600 text-white p-6 rounded-lg">
          <h2 className="text-2xl font-bold mb-2">مسح رمز QR</h2>
          <p className="opacity-90">امسح رمز QR لتسجيل حضورك</p>
        </div>

        <div className="bg-white p-4 sm:p-6 rounded-lg shadow-md border">
          <div className="text-center space-y-3 sm:space-y-4">
            {!showScanner ? (
              <>
                <Scan className="w-12 h-12 sm:w-16 sm:h-16 mx-auto text-green-500" />
                <h3 className="text-lg sm:text-xl font-semibold">مسح رمز الحضور</h3>
                <button
                  onClick={() => setShowScanner(true)}
                  className="bg-green-600 text-white px-4 sm:px-6 py-2 sm:py-3 rounded-md hover:bg-green-700 transition-colors flex items-center gap-2 mx-auto text-sm sm:text-base"
                >
                  <QrCode className="w-5 h-5" />
                  فتح كاميرا المسح
                </button>
              </>
            ) : (
              <div className="space-y-4">
                <div className="relative">
                  <div id="qr-reader" className="w-full"></div>
                  <button
                    onClick={() => {
                      setShowScanner(false);
                      const scanner = new Html5QrcodeScanner("qr-reader", { 
                        fps: 10, 
                        qrbox: 250 
                      });
                      scanner.clear();
                    }}
                    className="absolute top-2 right-2 bg-white p-2 rounded-full shadow-md"
                  >
                    ✕
                  </button>
                </div>
                {scanResult && (
                  <div className={`p-4 rounded-md ${
                    scanResult.includes('بنجاح') 
                      ? 'bg-green-50 border border-green-200 text-green-800' 
                      : scanResult.includes('غير صالح') || scanResult.includes('مسبقاً')
                      ? 'bg-red-50 border border-red-200 text-red-800'
                      : 'bg-blue-50 border border-blue-200 text-blue-800'
                  }`}>
                    <div className="flex items-center justify-center gap-2">
                      {isScanning ? (
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
                      ) : (
                        <CheckCircle className="w-4 h-4" />
                      )}
                      <span className="font-medium">{scanResult}</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* عداد الحضور للضيوف */}
        {eventData.totalGuests > 0 && (
          <div className="bg-white p-4 rounded-lg shadow-md border">
            <div className="text-center">
              <h4 className="font-semibold mb-2">حالة الحضور</h4>
              <div className="text-2xl font-bold text-green-600">
                {eventData.attendedGuests} / {eventData.totalGuests}
              </div>
              <p className="text-sm text-gray-600">ضيف حضر من إجمالي المدعوين</p>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 p-2 sm:p-4" dir="rtl">
      <div className="max-w-7xl mx-auto">
        {/* شريط التنقل */}
        <div className="bg-white rounded-lg shadow-md p-3 sm:p-4 mb-4 sm:mb-6">
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-4">
            <button
              onClick={() => setCurrentView('organizer')}
              className={`flex-1 py-2 sm:py-3 px-3 sm:px-4 rounded-md transition-colors flex items-center justify-center gap-1.5 sm:gap-2 text-sm sm:text-base ${
                currentView === 'organizer'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <Settings className="w-4 h-4 sm:w-5 sm:h-5" />
              منظم الحفلة
            </button>
            <button
              onClick={() => setCurrentView('guest')}
              className={`flex-1 py-2 sm:py-3 px-3 sm:px-4 rounded-md transition-colors flex items-center justify-center gap-1.5 sm:gap-2 text-sm sm:text-base ${
                currentView === 'guest'
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              <Scan className="w-4 h-4 sm:w-5 sm:h-5" />
              الضيف
            </button>
          </div>
        </div>

        {/* المحتوى الرئيسي */}
        {currentView === 'organizer' ? <OrganizerView /> : <GuestView />}
      </div>
    </div>
  );
};

export default QRAttendanceSystem;
