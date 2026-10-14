import React, { createContext, useContext, useState } from 'react';

export type Lang = 'en' | 'ar';

// Namespaced flat keys (e.g. "nav.dashboard") rather than nested objects —
// keeps t() a single string lookup and makes it trivial to grep for a
// missing translation. Add new keys here as more pages are translated;
// anything not yet added just falls back to the English string itself.
const STRINGS: Record<string, { en: string; ar: string }> = {
  // ---- Sidebar / navigation ----
  'app.name': { en: 'Staff Scheduler', ar: 'مجدول الموظفين' },
  'app.tagline': { en: 'Operational Portal', ar: 'بوابة التشغيل' },
  'nav.section': { en: 'Navigation', ar: 'التنقل' },
  'nav.dashboard': { en: 'Dashboard', ar: 'الرئيسية' },
  'nav.scheduleManagement': { en: 'Schedule Management', ar: 'إدارة الجدول' },
  'nav.coverage': { en: 'Coverage & Analytics', ar: 'التغطية والتحليلات' },
  'nav.userManagement': { en: 'User Management', ar: 'إدارة المستخدمين' },
  'nav.mySchedule': { en: 'My Schedule', ar: 'جدولي' },
  'nav.allEmployees': { en: 'All Employees', ar: 'كل الموظفين' },
  'nav.branchSchedule': { en: 'Branch Schedule', ar: 'جدول الفروع' },
  'nav.evaluations': { en: 'Evaluations', ar: 'التقييمات' },
  'nav.liveBreaks': { en: 'Live Breaks', ar: 'البريكات المباشرة' },
  'nav.agentKpis': { en: 'Agent Performance', ar: 'أداء الموظفين' },
  'nav.sickDocs': { en: 'Sick Documents', ar: 'مستندات الإجازة المرضية' },
  'nav.attendance': { en: 'Attendance', ar: 'الحضور' },
  'nav.swaps': { en: 'Shift Swaps', ar: 'تبديل الشيفتات' },
  'nav.requests': { en: 'Requests', ar: 'الطلبات' },
  'nav.audit': { en: 'Activity Log', ar: 'سجل النشاط' },
  'sidebar.password': { en: 'Password', ar: 'كلمة المرور' },
  'sidebar.logout': { en: 'Logout', ar: 'تسجيل خروج' },
  'sidebar.systemOnline': { en: 'System Online', ar: 'النظام يعمل' },
  'sidebar.corporate': { en: 'Corporate', ar: 'الإدارة' },
  'notifications.title': { en: 'Notifications', ar: 'الإشعارات' },
  'notifications.empty': { en: 'No notifications yet.', ar: 'لا توجد إشعارات بعد.' },
  'toggle.theme': { en: 'Toggle theme', ar: 'تبديل المظهر' },
  'toggle.language': { en: 'العربية', ar: 'English' },

  // ---- Dashboard ----
  'dashboard.globalHub': { en: 'Global Hub', ar: 'المركز الرئيسي' },
  'dashboard.operationDashboard': { en: 'Operation Dashboard', ar: 'لوحة التشغيل' },
  'dashboard.live': { en: 'Live', ar: 'مباشر' },
  'dashboard.allCompanies': { en: 'All Companies', ar: 'كل الشركات' },
  'dashboard.allBranches': { en: 'All Branches', ar: 'كل الفروع' },
  'dashboard.allBrands': { en: 'All Brands', ar: 'كل البراندات' },
  'dashboard.systemsActive': { en: 'Systems Active', ar: 'النظام نشط' },
  'common.total': { en: 'Total', ar: 'إجمالي' },
  'common.workforce': { en: 'Workforce', ar: 'القوى العاملة' },
  'common.workingIn': { en: 'Working in', ar: 'يعملون في' },
  'common.allCompaniesLower': { en: 'all companies', ar: 'كل الشركات' },
  'dashboard.stat.employees': { en: 'Employees', ar: 'الموظفون' },
  'dashboard.stat.activeShifts': { en: 'Active Shifts', ar: 'الشيفتات النشطة' },
  'dashboard.stat.activeShifts.desc': { en: 'Currently on duty', ar: 'على رأس العمل الآن' },
  'dashboard.stat.onBreak': { en: 'On Break', ar: 'في بريك' },
  'dashboard.stat.onBreak.desc': { en: 'Taking a pause', ar: 'في استراحة' },
  'dashboard.stat.offToday': { en: 'Off Today', ar: 'إجازة اليوم' },
  'dashboard.stat.offToday.desc': { en: 'Not scheduled today', ar: 'غير مجدول اليوم' },
  'dashboard.stat.swapAlerts': { en: 'Swap Alerts', ar: 'تنبيهات التبديل' },
  'dashboard.stat.swapAlerts.desc': { en: 'Awaiting decision', ar: 'في انتظار القرار' },
  'dashboard.onDutyRoster': { en: 'On-Duty Roster', ar: 'قائمة العاملين حاليًا' },
  'dashboard.liveNow': { en: 'Live Now', ar: 'مباشر الآن' },
  'dashboard.noActiveShifts': { en: 'No active shifts found for this selection.', ar: 'لا توجد شيفتات نشطة لهذا الاختيار.' },
  'dashboard.todaysBreakdown': { en: "Today's Breakdown", ar: 'ملخص اليوم' },
  'dashboard.scheduledToday': { en: 'Scheduled Today', ar: 'مجدول اليوم' },
  'dashboard.pendingApprovals': { en: 'Pending Approvals', ar: 'موافقات معلقة' },
  'dashboard.breakdown.onShift': { en: 'On Shift Today', ar: 'على الشيفت اليوم' },
  'dashboard.breakdown.dayOff': { en: 'Day Off', ar: 'إجازة' },
  'dashboard.breakdown.onLeave': { en: 'On Leave / Holiday', ar: 'إجازة / عطلة رسمية' },
  'dashboard.breakdown.absent': { en: 'Absent', ar: 'غائب' },
  'dashboard.breakdown.pending': { en: 'Pending Requests', ar: 'طلبات معلقة' },
  'dashboard.overtimeToday': { en: 'Overtime today', ar: 'أوفرتايم اليوم' },
  'dashboard.monthlyOvertimeReport': { en: 'Monthly Overtime Report', ar: 'تقرير الأوفرتايم الشهري' },
  'dashboard.forPayroll': { en: 'For payroll', ar: 'للرواتب' },

  // ---- My Schedule ----
  'mySchedule.title': { en: 'My Schedule', ar: 'جدولي' },
  'mySchedule.subtitle': { en: 'Weekly shift overview and roster', ar: 'نظرة عامة على الشيفتات الأسبوعية' },
  'mySchedule.totalAnnual': { en: 'Total Annual', ar: 'إجمالي السنوية' },
  'mySchedule.taken': { en: 'Taken', ar: 'المستخدم' },
  'mySchedule.remaining': { en: 'Remaining', ar: 'المتبقي' },
  'mySchedule.totalPublic': { en: 'Total Public', ar: 'إجمالي الرسمية' },
  'mySchedule.days': { en: 'Days', ar: 'يوم' },
  'mySchedule.requestSwap': { en: 'Request Swap', ar: 'طلب تبديل' },
  'mySchedule.breakSchedule': { en: 'Break Schedule', ar: 'جدول البريك' },
  'mySchedule.noBreaks': { en: 'No breaks defined', ar: 'لا يوجد بريك محدد' },
  'mySchedule.shiftTime': { en: 'Shift Time', ar: 'وقت الشيفت' },
  'mySchedule.homeShift': { en: 'Home Shift', ar: 'شيفت من المنزل' },
  'mySchedule.progress': { en: 'Progress', ar: 'التقدم' },
  'mySchedule.overtime': { en: 'Overtime', ar: 'أوفرتايم' },
  'mySchedule.overtimeAdded': { en: 'h added to this shift', ar: ' ساعة أضيفت لهذا الشيفت' },

  // ---- Login ----
  'login.heroTitle1': { en: 'Schedule', ar: 'إدارة' },
  'login.heroTitle2': { en: 'Management', ar: 'الجدول' },
  'login.heroTitle3': { en: 'System', ar: 'الزمني' },
  'login.heroDesc': { en: 'A professional platform designed for efficient handling and tracking of employee schedules across all branches and brands.', ar: 'منصة احترافية مصممة لإدارة وتتبع جداول الموظفين بكفاءة عبر كل الفروع والبراندات.' },
  'login.title': { en: 'Schedule System', ar: 'نظام الجدولة' },
  'login.subtitle': { en: 'Enter your credentials to access your account', ar: 'أدخل بياناتك للدخول لحسابك' },
  'login.systemSetup': { en: 'System Setup', ar: 'إعداد النظام' },
  'login.noSupervisor': { en: 'No supervisor found. Create the global access account now.', ar: 'لا يوجد سوبرفايزر. أنشئ حساب الوصول الرئيسي الآن.' },
  'login.createSupervisor': { en: 'Create Initial Supervisor', ar: 'إنشاء أول سوبرفايزر' },
  'login.username': { en: 'Username', ar: 'اسم المستخدم' },
  'login.password': { en: 'Password', ar: 'كلمة المرور' },
  'login.authenticating': { en: 'Authenticating...', ar: 'جاري الدخول...' },
  'login.signIn': { en: 'Sign In to Dashboard', ar: 'تسجيل الدخول' },
  'login.invalidCreds': { en: 'Invalid username or password', ar: 'اسم المستخدم أو كلمة المرور غير صحيحة' },
  'login.connectionError': { en: 'Connection error. Check Firebase status.', ar: 'خطأ في الاتصال. تحقق من حالة الخادم.' },
  'login.rights': { en: 'ALL RIGHTS RESERVED.', ar: 'جميع الحقوق محفوظة.' },

  // ---- User Management ----
  'users.title': { en: 'User Management', ar: 'إدارة المستخدمين' },
  'users.subtitle': { en: 'Create and manage access for your employees across the platform.', ar: 'أنشئ وأدر صلاحيات دخول الموظفين في النظام.' },
  'users.addNew': { en: 'Add New Employee', ar: 'إضافة موظف جديد' },
  'users.search': { en: 'Search by name, ID, username or company...', ar: 'بحث بالاسم أو الرقم أو اسم المستخدم أو الشركة...' },

  // ---- Coverage ----
  'coverage.title': { en: 'Coverage & Analytics', ar: 'التغطية والتحليلات' },
  'coverage.managersOnly': { en: 'Managers & supervisors only', ar: 'للمديرين والمشرفين فقط' },

  // ---- Evaluations ----
  'evaluations.search': { en: 'Search by name, ID or job...', ar: 'بحث بالاسم أو الرقم أو الوظيفة...' },

  // ---- All Employees ----
  'allEmployees.title': { en: 'All Employees', ar: 'كل الموظفين' },
  'allEmployees.search': { en: 'Search employees by name or title...', ar: 'بحث بالاسم أو المسمى الوظيفي...' },

  // ---- Branch Schedule ----
  'branchSchedule.title': { en: 'Branch Schedule', ar: 'جدول الفروع' },
  'branchSchedule.search': { en: 'Search by name, phone, ID or job...', ar: 'بحث بالاسم أو الهاتف أو الرقم أو الوظيفة...' },

  // ---- Live Breaks (manager view) ----
  'liveBreaks.title': { en: 'Live Breaks', ar: 'البريكات المباشرة' },
  'liveBreaks.subtitle': { en: 'Your branch, updating in real time.', ar: 'فرعك، يتحدث لحظيًا.' },
  'liveBreaks.subtitleDept': { en: 'Your department, updating in real time.', ar: 'قسمك، يتحدث لحظيًا.' },
  'liveBreaks.subtitleAll': { en: 'Every branch and department, updating in real time.', ar: 'كل الفروع والأقسام، يتحدث لحظيًا.' },
  'liveBreaks.search': { en: 'Search by name or employee ID...', ar: 'بحث بالاسم أو رقم الموظف...' },
  'liveBreaks.empty': { en: 'No employees in your scope yet.', ar: 'لا يوجد موظفون في نطاقك بعد.' },
  'liveBreaks.noMatch': { en: 'No employees match that search.', ar: 'لا يوجد موظفون يطابقون هذا البحث.' },
  'liveBreaks.tabLive': { en: 'Live', ar: 'مباشر' },
  'liveBreaks.tabReport': { en: 'Report', ar: 'تقرير' },

  // ---- Swap Requests ----
  'swaps.title': { en: 'Shift Swaps', ar: 'تبديل الشيفتات' },

  // ---- Requests ----
  'requests.title': { en: 'Requests', ar: 'الطلبات' },

  // ---- Audit Log ----
  'audit.title': { en: 'Activity Log', ar: 'سجل النشاط' },
  'audit.supervisorOnly': { en: 'Supervisor access only', ar: 'لصلاحية السوبرفايزر فقط' },
  'audit.search': { en: 'Search by employee, action, or description...', ar: 'بحث بالموظف أو الإجراء أو الوصف...' },
  'audit.from': { en: 'From', ar: 'من' },
  'audit.to': { en: 'To', ar: 'إلى' },
  'audit.clearDates': { en: 'Clear dates', ar: 'مسح التواريخ' },

  // ---- Schedule Management ----
  'scheduleMgmt.title': { en: 'Master Roster', ar: 'الجدول الرئيسي' },

  // ---- In-system voice calls ----
  'call.someone': { en: 'Someone', ar: 'شخص ما' },
  'call.incoming': { en: 'Incoming call', ar: 'مكالمة واردة' },
  'call.calling': { en: 'Calling...', ar: 'جاري الاتصال...' },
  'call.connecting': { en: 'Connecting...', ar: 'جاري التوصيل...' },
  'call.answer': { en: 'Answer', ar: 'رد' },
  'call.decline': { en: 'Decline', ar: 'رفض' },
  'call.end': { en: 'End Call', ar: 'إنهاء المكالمة' },
  'call.mute': { en: 'Mute', ar: 'كتم الصوت' },
  'call.unmute': { en: 'Unmute', ar: 'إلغاء الكتم' },
  'call.button': { en: 'Call', ar: 'اتصال' },
  'call.err.mic': { en: 'Could not access your microphone.', ar: 'تعذر الوصول إلى الميكروفون.' },
  'call.err.offline': { en: 'Not connected — reconnecting. Please try again in a moment.', ar: 'غير متصل — جاري إعادة الاتصال. حاول مرة أخرى بعد لحظات.' },
  'call.err.noack': { en: 'Could not reach the server. Please try again.', ar: 'تعذر الوصول إلى السيرفر. حاول مرة أخرى.' },
  'call.err.declined': { en: 'The call was declined.', ar: 'تم رفض المكالمة.' },
  'call.err.noanswer': { en: 'No answer.', ar: 'لا يوجد رد.' },
  'call.err.gone': { en: 'That call is no longer available.', ar: 'هذه المكالمة لم تعد متاحة.' },
  'call.err.tapAnswer': { en: 'Tap Answer to allow the microphone.', ar: 'اضغط "رد" للسماح باستخدام الميكروفون.' },
  'call.recording': { en: 'Recording', ar: 'جاري التسجيل' },

  // ---- Call history (admin) ----
  'nav.callLog': { en: 'Call History', ar: 'سجل المكالمات' },
  'call.log.title': { en: 'Call History', ar: 'سجل المكالمات' },
  'call.log.subtitle': { en: 'Every call made on the system — answered or not — with recordings.', ar: 'كل مكالمة تمت على السيستم — تم الرد عليها أو لا — مع التسجيلات.' },
  'call.log.adminAccess': { en: 'Admin Access', ar: 'صلاحية الأدمن' },
  'call.log.adminOnly': { en: 'Admins only', ar: 'للأدمن فقط' },
  'call.log.search': { en: 'Search by caller or receiver...', ar: 'ابحث باسم المتصل أو المستقبل...' },
  'call.log.loading': { en: 'Loading...', ar: 'جاري التحميل...' },
  'call.log.empty': { en: 'No calls found', ar: 'لا توجد مكالمات' },
  'call.log.total': { en: 'Total', ar: 'الإجمالي' },
  'call.log.answered': { en: 'Answered', ar: 'تم الرد' },
  'call.log.missed': { en: 'Missed', ar: 'لم يرد' },
  'call.log.declined': { en: 'Declined', ar: 'مرفوضة' },
  'call.log.canceled': { en: 'Canceled', ar: 'ملغاة' },
  'call.log.ringing': { en: 'Ringing', ar: 'يرن الآن' },
  'call.log.interrupted': { en: 'Interrupted', ar: 'انقطعت' },
  'call.log.recorded': { en: 'Recorded', ar: 'مسجّلة' },
  'call.log.neverReached': { en: 'Never reached', ar: 'لم تصله' },
  'call.log.rangNoAnswer': { en: 'Rang · no answer', ar: 'رنّت · بدون رد' },
  'call.log.noRecording': { en: 'No recording', ar: 'لا يوجد تسجيل' },
  'call.log.play': { en: 'Play recording', ar: 'تشغيل التسجيل' },
  'call.log.stop': { en: 'Stop', ar: 'إيقاف' },
  'call.log.download': { en: 'Download', ar: 'تحميل' },
  'call.log.delete': { en: 'Delete recording', ar: 'حذف التسجيل' },
  'call.log.confirmDelete': { en: 'Delete this recording permanently?', ar: 'حذف هذا التسجيل نهائياً؟' },
  'call.log.retentionNote': { en: 'Recordings are kept for 30 days, then deleted automatically.', ar: 'يتم الاحتفاظ بالتسجيلات لمدة ٣٠ يوم ثم تُحذف تلقائياً.' },
  'call.log.filter.all': { en: 'All', ar: 'الكل' },
  'call.log.filter.answered': { en: 'Answered', ar: 'تم الرد' },
  'call.log.filter.missed': { en: 'Missed', ar: 'لم يرد' },
  'call.log.filter.declined': { en: 'Declined', ar: 'مرفوضة' },
  'call.log.filter.canceled': { en: 'Canceled', ar: 'ملغاة' },
  'call.log.filter.recorded': { en: 'Recorded', ar: 'مسجّلة' },
  'call.log.canceledBy': { en: 'Canceled by', ar: 'ألغاها' },
  'call.log.declinedBy': { en: 'Declined by', ar: 'رفضها' },
  'call.log.endedBy': { en: 'Ended by', ar: 'أنهاها' },
  'call.log.justNow': { en: 'just now', ar: 'الآن' },
  'call.log.disconnected': { en: 'Connection lost', ar: 'انقطع الاتصال' },
  'call.log.disconnectedBy': { en: 'Lost connection:', ar: 'انقطع اتصال:' },

  // ---- Staff directory (branch staff calling the department side) ----
  'nav.staffDirectory': { en: 'Staff Directory', ar: 'دليل الموظفين' },
  'directory.title': { en: 'Staff Directory', ar: 'دليل الموظفين' },
  'directory.subtitle': { en: 'Find and call Call Center, Technical, Complain and Quality staff.', ar: 'ابحث واتصل بموظفي الكول سنتر والتكنيكال والشكاوى والجودة.' },
  'directory.search': { en: 'Search by name or job title...', ar: 'ابحث بالاسم أو المسمى الوظيفي...' },
  'directory.all': { en: 'All', ar: 'الكل' },
  'directory.people': { en: 'people', ar: 'موظف' },
  'directory.loading': { en: 'Loading...', ar: 'جاري التحميل...' },
  'directory.empty': { en: 'No one found', ar: 'لا يوجد أحد' },
  'directory.failed': { en: 'Could not load the directory. Please try again.', ar: 'تعذر تحميل الدليل. حاول مرة أخرى.' },

  // ---- Notification permission prompt ----
  'notif.gate.title': { en: 'Calls will not reach you', ar: 'المكالمات لن تصلك' },
  'notif.gate.body': { en: 'Turn on notifications so an incoming call rings you even when the app is closed.', ar: 'فعّل الإشعارات عشان المكالمة توصلك حتى لو التطبيق مقفول.' },
  'notif.gate.blocked': { en: 'Notifications are blocked for this site. Open your browser settings for this page and allow notifications, otherwise calls can only reach you while the app is open.', ar: 'الإشعارات محظورة لهذا الموقع. افتح إعدادات المتصفح لهذه الصفحة واسمح بالإشعارات، وإلا المكالمات لن تصلك إلا والتطبيق مفتوح.' },
  'notif.gate.enable': { en: 'Enable', ar: 'تفعيل' },
  'notif.gate.enabling': { en: 'Enabling...', ar: 'جاري التفعيل...' },
  'notif.gate.later': { en: 'Later', ar: 'لاحقاً' },

  // ---- Evaluations (continued) ----
  'evaluations.myTitle': { en: 'My Evaluations', ar: 'تقييماتي' },
  'evaluations.myHistory': { en: 'Employee of the Month scoring history', ar: 'سجل تقييم موظف الشهر' },
  'evaluations.noneYet': { en: 'No evaluations yet', ar: 'لا توجد تقييمات بعد' },
  'evaluations.title': { en: 'Employee Evaluations', ar: 'تقييمات الموظفين' },
  'evaluations.subtitle': { en: 'Score your branch employees against the Employee of the Month criteria.', ar: 'قيّم موظفي فرعك حسب معايير موظف الشهر.' },
  'evaluations.noneFound': { en: 'No branch employees found', ar: 'لا يوجد موظفو فروع' },
  'evaluations.evaluate': { en: 'Evaluate', ar: 'تقييم' },
  'evaluations.history': { en: 'History', ar: 'السجل' },

  // ---- Attendance ----
  'attendance.scanTitle': { en: 'Scan to clock in / out', ar: 'اعمل سكان لتسجيل الحضور / الانصراف' },
  'attendance.pointCamera': { en: 'Open your phone camera and point it at the code.', ar: 'افتح كاميرا موبايلك ووجّهها على الكود.' },
  'attendance.myTitle': { en: 'My Attendance', ar: 'حضوري' },
  'attendance.onSite': { en: 'On site', ar: 'موجود بالفرع' },
  'attendance.notClockedIn': { en: 'Not clocked in', ar: 'لم يسجل حضور' },
  'attendance.noneRecorded': { en: 'No attendance recorded yet.', ar: 'لا يوجد سجل حضور بعد.' },
  'attendance.recentScans': { en: 'Recent Scans', ar: 'آخر عمليات المسح' },
  'attendance.clockedIn': { en: 'Clocked in', ar: 'سجل حضور' },
  'attendance.clockedOut': { en: 'Clocked out', ar: 'سجل انصراف' },
  'attendance.title': { en: 'Attendance', ar: 'الحضور' },
  'attendance.updatingLive': { en: 'updating live', ar: 'يتحدث لحظيًا' },
  'attendance.showQR': { en: 'Show QR on this screen', ar: 'اعرض الـ QR على الشاشة' },
  'attendance.left': { en: 'Left', ar: 'انصرف' },
  'attendance.noScan': { en: 'No scan', ar: 'لم يسجل' },
  'attendance.worked': { en: 'Worked', ar: 'المدة' },
  'attendance.noPunchOut': { en: 'No out', ar: 'بدون خروج' },
  'attendance.adminOnly': { en: 'Attendance records are restricted', ar: 'سجلات الحضور مقيدة' },
  'attendance.adminOnlyHint': { en: 'Only an administrator can view staff attendance. You can still show the QR code for your team to clock in.', ar: 'الأدمن فقط يمكنه عرض سجلات حضور الموظفين. لا يزال بإمكانك عرض رمز QR ليسجل فريقك الحضور.' },
  'attendance.missedPunch': { en: 'No clock-out', ar: 'لم يبصم خروج' },

  // ---- Lateness (fingerprint vs the roster) ----
  'late.tabBoard': { en: 'Attendance board', ar: 'لوحة الحضور' },
  'late.tabReview': { en: 'Lateness', ar: 'التأخير' },
  'late.title': { en: 'Lateness review', ar: 'مراجعة التأخير' },
  'late.subtitle': { en: 'Fingerprint arrivals compared with the scheduled shift', ar: 'مقارنة بصمة الحضور بموعد الشفت المجدول' },
  'late.grace': { en: 'Grace', ar: 'فترة السماح' },
  'late.needsReview': { en: 'Needs review', ar: 'يحتاج مراجعة' },
  'late.showAll': { en: 'Show every day', ar: 'عرض كل الأيام' },
  'late.onlyFindings': { en: 'Only findings', ar: 'الحالات فقط' },
  'late.empty': { en: 'Nothing to review in this range', ar: 'لا يوجد ما يستدعي المراجعة في هذه الفترة' },
  'late.emptyHint': { en: 'Every scheduled shift in these days was matched to an on-time arrival.', ar: 'كل شفت مجدول في هذه الأيام قوبل ببصمة حضور في موعدها.' },
  'late.scheduled': { en: 'Scheduled', ar: 'المجدول' },
  'late.arrived': { en: 'Arrived', ar: 'الحضور' },
  'late.confirm': { en: 'Record as late', ar: 'تسجيل كتأخير' },
  'late.recordEarly': { en: 'Record early leave', ar: 'تسجيل انصراف مبكر' },
  'late.recordAbsent': { en: 'Record as absent', ar: 'تسجيل غياب' },
  'late.leftEarlyBy': { en: 'Left {n} min before the end', ar: 'انصرف قبل النهاية بـ {n} دقيقة' },
  'late.why.LEFT_EARLY_LONG': { en: 'That is a long time before the end — it could also be a clock-out they forgot to make later.', ar: 'ده وقت طويل قبل النهاية — ممكن كمان يكون نسي يبصم خروج بعد كده.' },
  'late.why.NO_PUNCH': { en: 'Scheduled, the shift has started, and the terminal recorded nothing.', ar: 'مجدول، والشفت بدأ، وجهاز البصمة لم يسجل أي شيء.' },
  'late.dismiss': { en: 'Dismiss', ar: 'تجاهل' },
  'late.confirmed': { en: 'Recorded', ar: 'تم التسجيل' },
  'late.dismissed': { en: 'Dismissed', ar: 'تم التجاهل' },
  'late.alreadyOnRoster': { en: 'On the roster as {n} min', ar: 'مسجل في الجدول {n} دقيقة' },
  'late.lastSync': { en: 'Terminal last reported', ar: 'آخر اتصال بجهاز البصمة' },
  'late.staleSync': { en: 'The fingerprint terminal has not reported recently — findings may be incomplete.', ar: 'جهاز البصمة لم يرسل بيانات مؤخرًا — النتائج قد تكون ناقصة.' },
  'late.totalMinutes': { en: 'Late minutes', ar: 'دقائق التأخير' },
  'late.rebuild': { en: 'Rebuild', ar: 'إعادة حساب' },
  'late.rebuildHint': { en: 'Recalculates this range from the terminal. Use after backfilling history or adding an employee number.', ar: 'يعيد حساب هذه الفترة من جهاز البصمة. استخدمه بعد استيراد سجل قديم أو إضافة رقم وظيفي.' },
  // XonTel — the second clock
  'xon.col': { en: 'XonTel', ar: 'زونتل' },
  'xon.colHint': { en: 'First login on XonTel — when they began taking calls', ar: 'أول تسجيل دخول على زونتل — بداية استقبال المكالمات' },
  'xon.gap': { en: 'To calls', ar: 'حتى المكالمات' },
  'xon.notLinked': { en: 'Not linked to a XonTel agent', ar: 'غير مرتبط بحساب زونتل' },
  'xon.noLogin': { en: 'No XonTel login in this shift', ar: 'لم يسجل دخول على زونتل في هذا الشفت' },
  'xon.notConfigured': { en: 'XonTel is not connected on this server yet.', ar: 'زونتل غير متصل بالسيرفر بعد.' },
  'xon.lastSync': { en: 'XonTel last pulled', ar: 'آخر سحب من زونتل' },
  'xon.stale': { en: 'XonTel has not been pulled recently — logins may be missing.', ar: 'لم يتم السحب من زونتل مؤخرًا — قد تكون تسجيلات الدخول ناقصة.' },
  'xon.link': { en: 'Link XonTel agents', ar: 'ربط حسابات زونتل' },
  'xon.linkTitle': { en: 'XonTel agent links', ar: 'ربط حسابات زونتل' },
  'xon.linkHint': { en: 'Each person is matched to their XonTel agent once. Suggested matches come from the name — confirm or change them; nothing is linked on its own.', ar: 'كل موظف يُربط بحسابه على زونتل مرة واحدة. الاقتراحات مبنية على الاسم — أكّدها أو غيّرها؛ لا يُربط شيء تلقائيًا.' },
  'xon.linked': { en: 'Linked', ar: 'مرتبط' },
  'xon.suggested': { en: 'Suggested', ar: 'مقترح' },
  'xon.unlinked': { en: 'Unlinked', ar: 'غير مرتبط' },
  'xon.choose': { en: 'Choose a XonTel agent…', ar: 'اختر حساب زونتل…' },
  'xon.confirm': { en: 'Confirm', ar: 'تأكيد' },
  'xon.unlink': { en: 'Unlink', ar: 'فك الربط' },
  'xon.pull': { en: 'Pull from XonTel', ar: 'سحب من زونتل' },
  'xon.calls': { en: 'Real calls', ar: 'المكالمات الفعلية' },
  'xon.callsNote': { en: 'From the call records — when a call actually started and ended.', ar: 'من سجل المكالمات — بداية ونهاية كل مكالمة فعلية.' },
  'xon.talkTime': { en: 'Talk time', ar: 'وقت الكلام' },
  'xon.answered': { en: 'answered', ar: 'تم الرد' },
  'xon.missed': { en: 'missed', ar: 'لم يُرد' },
  'xon.noCalls': { en: 'No calls on this day', ar: 'لا توجد مكالمات في هذا اليوم' },
  'xon.phantom': { en: 'In call, no call', ar: 'حالة مكالمة بدون مكالمة' },
  'xon.phantomHint': { en: 'Time the status sat on "in call" with no real call underneath it. The status is parked, not measured.', ar: 'وقت كانت الحالة فيه "في مكالمة" من غير مكالمة فعلية تحتها. الحالة واقفة، مش مقاسة.' },
  'xon.totals': { en: 'Time by status', ar: 'الوقت حسب الحالة' },
  'xon.totalsNote': { en: 'How long each status was set — not measured activity, since a status keeps running until the agent changes it. Talk time, in blue, is the measured one and comes from the call records.', ar: 'مدة بقاء كل حالة مضبوطة — مش قياس فعلي، لأن الحالة بتفضل شغالة لحد ما الموظف يغيّرها. وقت الكلام (بالأزرق) هو الوحيد المقاس فعليًا، وجاي من سجل المكالمات.' },
  'xon.timeline': { en: 'Timeline', ar: 'التسلسل' },
  'xon.openDay': { en: 'Show their XonTel day', ar: 'عرض يومه على زونتل' },
  'xon.awaySeconds': { en: 'away', ar: 'خارج الاستعداد' },
  'xon.pullHint': { en: 'Fetches the XonTel sessions for the selected dates now.', ar: 'يسحب جلسات زونتل للتواريخ المحددة الآن.' },

  // Status labels
  'late.st.LATE': { en: 'Late', ar: 'متأخر' },
  'late.st.LEFT_EARLY': { en: 'Left early', ar: 'انصرف مبكرًا' },
  'late.st.ON_TIME': { en: 'On time', ar: 'في الموعد' },
  'late.st.EXCUSED': { en: 'Permitted', ar: 'بإذن' },
  'late.st.SHIFT_MISMATCH': { en: 'Roster mismatch', ar: 'الجدول غير مطابق' },
  'late.st.LONE_PUNCH': { en: 'One punch only', ar: 'بصمة واحدة فقط' },
  'late.st.ONLY_OUT': { en: 'No clock-in', ar: 'بدون بصمة دخول' },
  'late.st.NO_PUNCH': { en: 'No punch', ar: 'لم يبصم' },
  'late.st.NOT_SYNCED': { en: 'Not reported yet', ar: 'لم يصل بعد' },
  'late.st.PENDING': { en: 'Not started', ar: 'لم يبدأ' },
  'late.why.SHIFT_MISMATCH': { en: 'Arrived and left by about the same amount — the roster hours look wrong, not the person.', ar: 'حضر وانصرف متأخرًا بنفس المقدار تقريبًا — الخطأ في ساعات الجدول وليس في الموظف.' },
  'late.why.LONE_PUNCH': { en: 'A single punch all day: it cannot be told apart from a missed clock-in.', ar: 'بصمة واحدة طوال اليوم: لا يمكن تمييزها عن نسيان بصمة الدخول.' },
  'late.why.ONLY_OUT': { en: 'Punches exist for this shift but none of them reads as an arrival.', ar: 'توجد بصمات لهذا الشفت لكن لا توجد بصمة دخول.' },
  'late.why.NOT_SYNCED': { en: 'The terminal has not reported since this shift started, so silence does not mean absence.', ar: 'جهاز البصمة لم يرسل بيانات منذ بداية هذا الشفت، فالصمت لا يعني الغياب.' },

  // ---- Admin punch correction ----
  'attendance.edit.in': { en: 'Edit clock-in', ar: 'تعديل وقت الدخول' },
  'attendance.edit.out': { en: 'Edit clock-out', ar: 'تعديل وقت الخروج' },
  'attendance.edit.current': { en: 'Currently', ar: 'الوقت الحالي' },
  'attendance.edit.newTime': { en: 'New time', ar: 'الوقت الجديد' },
  'attendance.edit.save': { en: 'Save', ar: 'حفظ' },
  'attendance.edit.saving': { en: 'Saving...', ar: 'جاري الحفظ...' },
  'attendance.edit.delete': { en: 'Remove this punch', ar: 'حذف هذه البصمة' },
  'attendance.edit.confirmDelete': { en: 'Remove this punch permanently? It will not come back on the next sync.', ar: 'حذف هذه البصمة نهائياً؟ لن ترجع مع المزامنة القادمة.' },
  'attendance.edit.invalid': { en: 'Enter a valid date and time.', ar: 'أدخل تاريخاً ووقتاً صحيحين.' },
  'attendance.edit.failed': { en: 'Could not save the change.', ar: 'تعذر حفظ التعديل.' },
  'attendance.noScanYet': { en: 'No scan yet', ar: 'لم يسجل بعد' },
  'attendance.loadingTeam': { en: 'Loading your team...', ar: 'جاري تحميل فريقك...' },
};

export function t(key: string, lang: Lang): string {
  const entry = STRINGS[key];
  if (!entry) return key;
  return entry[lang] || entry.en;
}

interface LanguageContextType {
  lang: Lang;
  setLang: (l: Lang) => void;
  toggleLang: () => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType | null>(null);
export const useLanguage = () => useContext(LanguageContext)!;

const STORAGE_KEY = 'swipr_lang';

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved === 'ar' ? 'ar' : 'en';
    } catch {
      return 'en';
    }
  });

  const setLang = (l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(STORAGE_KEY, l); } catch { /* ignore */ }
  };
  const toggleLang = () => setLang(lang === 'en' ? 'ar' : 'en');

  return (
    <LanguageContext.Provider value={{ lang, setLang, toggleLang, t: (key: string) => t(key, lang) }}>
      {children}
    </LanguageContext.Provider>
  );
};
