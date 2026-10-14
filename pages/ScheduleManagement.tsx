
import React, { useState, useEffect, useMemo } from 'react';
import { 
  ChevronLeft, ChevronRight, Search, Coffee, X, Save, Calendar, Clock, Plus, Users, ShieldCheck, Timer, CheckSquare, Square, Moon, Mail, Briefcase, Building2, ClipboardList, FileSpreadsheet, ArrowRight, Filter, CalendarDays, Copy, Check, Home, Star, Palmtree, Thermometer, XCircle, LayoutGrid, Columns, Rows, History, Download, Upload, Trash2, GraduationCap, Mic, Sparkles, Wand2
} from 'lucide-react';
import { store } from '../store';
import { DayType, User, UserRole, ScheduleDay, Break, PublicHoliday, LeaveRequest, LeaveStatus, ShiftTemplate, dayTypeLabel, isBranchRole, roleLabel, unitOf } from '../types';
import { BRAND_NAMES, BRANDS } from '../brands';
import { addDays, format } from 'date-fns';
import { useAuth } from '../App';
import { useLanguage } from '../i18n';
import * as XLSX from 'xlsx';
import Avatar from '../Avatar';

const manualStartOfWeek = (date: Date) => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day;
  const start = new Date(d.setDate(diff));
  start.setHours(0, 0, 0, 0);
  return start;
};

const parseMinutes = (t: string) => {
  if (!t) return 0;
  const parts = t.split(':');
  if (parts.length < 2) return 0;
  const h = parseInt(parts[0], 10) || 0;
  const m = parseInt(parts[1], 10) || 0;
  return h * 60 + m;
};

const formatMinutes = (mTotal: number) => {
  const h = Math.floor(mTotal / 60) % 24;
  const m = Math.floor(mTotal % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};

const breakLabels = ["Morning Break", "Lunch", "Afternoon Break"];

const EGYPT_PUBLIC_HOLIDAYS = [
  // 2025
  { id: 'eg-2025-01-07', date: '2025-01-07', name: 'Coptic Christmas' },
  { id: 'eg-2025-01-25', date: '2025-01-25', name: 'Revolution Day / Police Day' },
  { id: 'eg-2025-03-30', date: '2025-03-30', name: 'Eid al-Fitr (Day 1)' },
  { id: 'eg-2025-03-31', date: '2025-03-31', name: 'Eid al-Fitr (Day 2)' },
  { id: 'eg-2025-04-01', date: '2025-04-01', name: 'Eid al-Fitr (Day 3)' },
  { id: 'eg-2025-04-21', date: '2025-04-21', name: 'Sham El-Nessim' },
  { id: 'eg-2025-04-25', date: '2025-04-25', name: 'Sinai Liberation Day' },
  { id: 'eg-2025-05-01', date: '2025-05-01', name: 'Labor Day' },
  { id: 'eg-2025-06-06', date: '2025-06-06', name: 'Eid al-Adha (Day 1)' },
  { id: 'eg-2025-06-07', date: '2025-06-07', name: 'Eid al-Adha (Day 2)' },
  { id: 'eg-2025-06-08', date: '2025-06-08', name: 'Eid al-Adha (Day 3)' },
  { id: 'eg-2025-06-09', date: '2025-06-09', name: 'Eid al-Adha (Day 4)' },
  { id: 'eg-2025-06-26', date: '2025-06-26', name: 'Islamic New Year' },
  { id: 'eg-2025-06-30', date: '2025-06-30', name: 'June 30 Revolution Day' },
  { id: 'eg-2025-07-23', date: '2025-07-23', name: 'Revolution Day' },
  { id: 'eg-2025-09-04', date: '2025-09-04', name: 'Prophet\'s Birthday' },
  { id: 'eg-2025-10-06', date: '2025-10-06', name: 'Armed Forces Day' },
  // 2026
  { id: 'eg-2026-01-07', date: '2026-01-07', name: 'Coptic Christmas' },
  { id: 'eg-2026-01-25', date: '2026-01-25', name: 'Revolution Day' },
  { id: 'eg-2026-03-20', date: '2026-03-20', name: 'Eid al-Fitr (Day 1)' },
  { id: 'eg-2026-03-21', date: '2026-03-21', name: 'Eid al-Fitr (Day 2)' },
  { id: 'eg-2026-03-22', date: '2026-03-22', name: 'Eid al-Fitr (Day 3)' },
  { id: 'eg-2026-04-13', date: '2026-04-13', name: 'Sham El-Nessim' },
  { id: 'eg-2026-04-25', date: '2026-04-25', name: 'Sinai Liberation Day' },
  { id: 'eg-2026-05-01', date: '2026-05-01', name: 'Labor Day' },
  { id: 'eg-2026-05-27', date: '2026-05-27', name: 'Eid al-Adha (Day 1)' },
  { id: 'eg-2026-05-28', date: '2026-05-28', name: 'Eid al-Adha (Day 2)' },
  { id: 'eg-2026-05-29', date: '2026-05-29', name: 'Eid al-Adha (Day 3)' },
  { id: 'eg-2026-05-30', date: '2026-05-30', name: 'Eid al-Adha (Day 4)' },
  { id: 'eg-2026-06-16', date: '2026-06-16', name: 'Islamic New Year' },
  { id: 'eg-2026-06-30', date: '2026-06-30', name: 'June 30 Revolution Day' },
  { id: 'eg-2026-07-23', date: '2026-07-23', name: 'Revolution Day' },
  { id: 'eg-2026-08-25', date: '2026-08-25', name: 'Prophet\'s Birthday' },
  { id: 'eg-2026-10-06', date: '2026-10-06', name: 'Armed Forces Day' },
];

// Sentinel value for the company dropdown: show only team-leader rows.
const TEAM_LEADERS_FILTER = '__TEAM_LEADERS__';

// Which roles each field-operations manager can schedule.
const BRANCH_TARGETS: Partial<Record<UserRole, UserRole[]>> = {
  [UserRole.BRANCH_MANAGER]: [UserRole.BRANCH_EMPLOYEE],
  [UserRole.AREA_MANAGER]: [UserRole.BRANCH_EMPLOYEE, UserRole.BRANCH_MANAGER],
  [UserRole.OPERATION_MANAGER]: [UserRole.BRANCH_EMPLOYEE, UserRole.BRANCH_MANAGER, UserRole.AREA_MANAGER],
};

// Roles that get a highlighted badge on their roster row.
const ELEVATED_ROLES = [UserRole.MANAGER, UserRole.BRANCH_MANAGER, UserRole.AREA_MANAGER];

export default function ScheduleManagement() {
  const { user: currentUser } = useAuth();
  const { t } = useLanguage();
  const isTop = currentUser?.role === UserRole.SUPERVISOR || currentUser?.role === UserRole.ADMIN;
  const branchViewer = !!currentUser && !!BRANCH_TARGETS[currentUser.role];
  // Team leaders manage their own department roster and get the same
  // toolbar (export, bulk upload, AI schedule, etc.) as supervisors/admins —
  // scoped to their own team since `employees` is already filtered for them.
  const canManageToolbar = isTop || branchViewer || currentUser?.role === UserRole.MANAGER;
  const [employees, setEmployees] = useState<User[]>([]);
  const [currentWeekStart, setCurrentWeekStart] = useState(manualStartOfWeek(new Date()));
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCompany, setSelectedCompany] = useState<string>('All');
  const [selectedTeamLeader, setSelectedTeamLeader] = useState<string>('All');
  const [selectedDayIndex, setSelectedDayIndex] = useState<number | 'all'>('all');
  const [viewMode, setViewMode] = useState<'horizontal' | 'grid' | 'vertical'>('horizontal');
  const [weeklyWrap, setWeeklyWrap] = useState(false);
  const [allSchedules, setAllSchedules] = useState<Record<string, Record<string, ScheduleDay>>>({});
  
  const [editingDay, setEditingDay] = useState<{ userId: string, date: string } | null>(null);
  const [editFormData, setEditFormData] = useState<ScheduleDay | null>(null);
  const [applyToWeek, setApplyToWeek] = useState(false);
  const [selectedWeekDays, setSelectedWeekDays] = useState<number[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [exportStartDate, setExportStartDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [exportEndDate, setExportEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [showRangeExportModal, setShowRangeExportModal] = useState(false);
  const [showAllCompanySummary, setShowAllCompanySummary] = useState(false);
  const [selectedEmployeeSummary, setSelectedEmployeeSummary] = useState<User | null>(null);
  const [summaryStartDate, setSummaryStartDate] = useState('');
  const [summaryEndDate, setSummaryEndDate] = useState('');
  const [mainStartDate, setMainStartDate] = useState('');
  const [mainEndDate, setMainEndDate] = useState('');
  const [historicalDate, setHistoricalDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [historicalType, setHistoricalType] = useState<DayType>(DayType.ANNUAL_LEAVE);
  const [showLeaveBalanceModal, setShowLeaveBalanceModal] = useState(false);
  const [showBulkUploadModal, setShowBulkUploadModal] = useState(false);
  const [showClearWeekModal, setShowClearWeekModal] = useState(false);
  const [bulkUploadProgress, setBulkUploadProgress] = useState<{ current: number, total: number, errors: string[] } | null>(null);
  const [balanceCalcStart, setBalanceCalcStart] = useState(format(new Date(), 'yyyy-MM-01'));
  const [balanceCalcEnd, setBalanceCalcEnd] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [publicHolidays, setPublicHolidays] = useState<PublicHoliday[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [templates, setTemplates] = useState<ShiftTemplate[]>([]);
  // AI / voice scheduling
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiText, setAiText] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiResult, setAiResult] = useState<{ employeeId: string; employeeName: string; note?: string; days: { date: string; type: string; startTime?: string | null; endTime?: string | null }[] } | null>(null);
  const [listening, setListening] = useState(false);
  const recognitionRef = React.useRef<any>(null);

  // Calculate total taken days for the selected employee to show remaining balance
  const employeeTotalTaken = useMemo(() => {
    if (!selectedEmployeeSummary) return { annual: 0, public: 0 };
    const empSchedules = allSchedules[selectedEmployeeSummary.id] || {};
    let annual = 0;
    let publicH = 0;
    Object.values(empSchedules).forEach(day => {
      if (day.type === DayType.ANNUAL_LEAVE) annual++;
      if (day.type === DayType.PUBLIC_HOLIDAY) publicH++;
    });
    return { annual, public: publicH };
  }, [selectedEmployeeSummary, allSchedules]);

  const holidaysInCalcRange = useMemo(() => {
    if (!balanceCalcStart || !balanceCalcEnd) return [];
    const start = new Date(balanceCalcStart.replace(/-/g, '/'));
    const end = new Date(balanceCalcEnd.replace(/-/g, '/'));
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return [];
    
    // Combine standard Egyptian holidays with any custom ones from Firestore
    const allHolidays = [...EGYPT_PUBLIC_HOLIDAYS, ...publicHolidays];
    // Filter unique by date to avoid double counting if user manually added them too
    const uniqueHolidays = Array.from(new Map(allHolidays.map(h => [h.date, h])).values());

    return uniqueHolidays.filter(h => {
      const hDate = new Date(h.date.replace(/-/g, '/'));
      return hDate >= start && hDate <= end;
    });
  }, [balanceCalcStart, balanceCalcEnd, publicHolidays]);

  // Filter options: department units always; branch units only for a
  // field-operations viewer's own (small) scope. The admin sees every
  // brand/branch system-wide, so that case gets a dedicated Brand → Branch
  // cascade below instead — a flat list would balloon past what a single
  // dropdown can usefully show.
  const { filterOptions, deptCompanies } = useMemo(() => {
    const set = new Set<string>();
    const dept = new Set<string>();
    employees.forEach(e => {
      const u = unitOf(e);
      if (!u) return;
      if (e.companyName?.trim()) {
        set.add(u);
        dept.add(u);
      } else if (branchViewer) {
        set.add(u);
      }
    });
    const opts = ['All', ...Array.from(set).sort()];
    // Supervisors/admins can narrow the roster to just their team leaders.
    if (isTop) opts.splice(1, 0, TEAM_LEADERS_FILTER);
    return { filterOptions: opts, deptCompanies: dept };
  }, [employees, isTop, branchViewer]);

  // Admin-only cascading Brand → Branch filter over the field-operations hierarchy.
  const [selectedBrand, setSelectedBrand] = useState('All');
  const [selectedBranch, setSelectedBranch] = useState('All');
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  
  // Robust normalization for team leader names to prevent duplicates
  const normalizeTL = (name: string | undefined) => {
    if (!name) return '';
    return name.toLowerCase()
      .replace(/[^a-z0-9]/g, '') // Remove everything except letters and numbers
      .trim();
  };

  // Extract unique team leaders from employees with aggressive normalization
  const teamLeaders = useMemo(() => {
    const uniqueMap = new Map<string, string>();
    employees.forEach(e => {
      const rawTl = e.teamLeader;
      if (rawTl && rawTl.trim()) {
        const tl = rawTl.trim();
        const key = normalizeTL(tl);
        
        if (key && !uniqueMap.has(key)) {
          uniqueMap.set(key, tl);
        }
      }
    });
    return ['All', ...Array.from(uniqueMap.values()).sort((a, b) => a.localeCompare(b))];
  }, [employees]);

  useEffect(() => {
    const unsubscribe = store.subscribeToUsers((users) => {
      let filtered: User[];
      const branchTargets = currentUser ? BRANCH_TARGETS[currentUser.role] : undefined;
      if (branchTargets) {
        // Field-operations managers: the server already scopes the list to
        // their brand/branches; keep the roles they may schedule, plus
        // themselves (every branch manager can set their own schedule too).
        filtered = users.filter(u => branchTargets.includes(u.role) || u.id === currentUser?.id);
      } else {
        // Supervisors and admins also see (and schedule) team leaders, not
        // just employees; admins additionally see the whole branch hierarchy.
        const canSeeLeaders = currentUser?.role === UserRole.ADMIN || currentUser?.role === UserRole.SUPERVISOR;
        filtered = users.filter(u =>
          u.role === UserRole.EMPLOYEE ||
          (canSeeLeaders && u.role === UserRole.MANAGER) ||
          (currentUser?.role === UserRole.ADMIN && isBranchRole(u.role))
        );
        if (currentUser?.role === UserRole.MANAGER) {
          const managed = currentUser.managedDepartments || [];
          filtered = filtered.filter(u =>
            u.companyName === currentUser.companyName ||
            managed.includes(u.companyName || '')
          );
        }
      }
      setEmployees(filtered);
    });
    
    const loadSchedules = async () => {
      const data = await store.getCurrentAppData();
      setAllSchedules(data.schedules);
    };
    
    loadSchedules();
    const unsubscribeHolidays = store.subscribeToPublicHolidays((holidays) => {
      setPublicHolidays(holidays);
    });
    const unsubscribeLeaves = store.subscribeToLeaveRequests((leaves) => {
      setLeaveRequests(leaves);
    });
    const unsubscribeTemplates = store.subscribeToTemplates(setTemplates);
    return () => {
      unsubscribe();
      unsubscribeHolidays();
      unsubscribeLeaves();
      unsubscribeTemplates();
    };
  }, [editingDay, currentUser]);

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(currentWeekStart, i));
  }, [currentWeekStart]);

  const rangeDays = useMemo(() => {
    if (!mainStartDate || !mainEndDate) return null;
    const start = new Date(mainStartDate.replace(/-/g, '/'));
    const end = new Date(mainEndDate.replace(/-/g, '/'));
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
    if (start > end) return null;

    const days = [];
    let curr = new Date(start);
    let count = 0;
    // Limit to 45 days for performance
    while (curr <= end && count < 45) {
      days.push(new Date(curr));
      curr = addDays(curr, 1);
      count++;
    }
    return days;
  }, [mainStartDate, mainEndDate]);

  const displayedDays = useMemo(() => {
    if (rangeDays) return rangeDays;
    if (selectedDayIndex === 'all') return weekDays;
    return [weekDays[selectedDayIndex]];
  }, [rangeDays, weekDays, selectedDayIndex]);

  const getShiftCollisionOffset = (userId: string, date: string, startTime: string, endTime: string): number => {
    const currentEmp = employees.find(e => e.id === userId);
    if (!currentEmp) return 0;
    let collisionCount = 0;
    Object.keys(allSchedules).forEach(otherUserId => {
      if (otherUserId === userId) return;
      const otherEmp = employees.find(e => e.id === otherUserId);
      if (!otherEmp || otherEmp.companyName !== currentEmp.companyName) return;
      const daySchedule = allSchedules[otherUserId]?.[date];
      if (daySchedule?.shift && 
          daySchedule.shift.startTime === startTime && 
          daySchedule.shift.endTime === endTime) {
        collisionCount++;
      }
    });
    return collisionCount * 15;
  };

  // Branch employees get blank, manually-entered breaks instead of the
  // auto-staggered call-center calculation. Empty strings (not "00:00",
  // which a time input renders as a real-looking 12:00 AM) so the field
  // shows "--:--". Every downstream consumer (Dashboard, Coverage, My
  // Schedule) skips breaks that are blank or have equal start/end, so an
  // unfilled break never surfaces to the employee as a real one.
  const emptyBreaks = (): [Break, Break, Break] => [
    { id: 'b1', start: '', end: '' },
    { id: 'b2', start: '', end: '' },
    { id: 'b3', start: '', end: '' },
  ];
  const isBranchEmployeeTarget = (userId: string) =>
    employees.find(e => e.id === userId)?.role === UserRole.BRANCH_EMPLOYEE;

  const calculateAutoBreaks = (startTime: string, endTime: string, offset: number = 0): [Break, Break, Break] => {
    const startMins = parseMinutes(startTime);
    const endMins = parseMinutes(endTime);
    const b1Start = startMins + 75 + offset; 
    const b1End = b1Start + 15;
    const b2Start = b1Start + 120 + offset; 
    const b2End = b2Start + 30;
    const b3Start = endMins - 90 + offset; 
    const b3End = b3Start + 15;
    return [
      { id: 'b1', start: formatMinutes(b1Start), end: formatMinutes(b1End) },
      { id: 'b2', start: formatMinutes(b2Start), end: formatMinutes(b2End) },
      { id: 'b3', start: formatMinutes(b3Start), end: formatMinutes(b3End) }
    ];
  };

  const handleTypeChange = (type: DayType) => {
    if (!editFormData || !editingDay) return;
    const newData = { ...editFormData, type };
    if ([DayType.NORMAL_SHIFT, DayType.WORK_FROM_HOME, DayType.TASK, DayType.TARDY, DayType.EARLY_LEAVE, DayType.DELAY_WAS_PERMISSION, DayType.CANCEL_OFF].includes(type) && !newData.shift) {
      const isBranchEmp = isBranchEmployeeTarget(editingDay.userId);
      const defaultStart = '08:00';
      const defaultEnd = isBranchEmp ? formatMinutes(parseMinutes(defaultStart) + 9 * 60) : '16:00';
      newData.shift = {
        startTime: defaultStart,
        endTime: defaultEnd,
        breaks: isBranchEmp
          ? emptyBreaks()
          : calculateAutoBreaks(defaultStart, defaultEnd, getShiftCollisionOffset(editingDay.userId, editingDay.date, defaultStart, defaultEnd))
      };
    }
    setEditFormData(newData);
  };

  const applyTemplate = (tpl: ShiftTemplate) => {
    if (!editFormData) return;
    setEditFormData({
      ...editFormData,
      type: tpl.type,
      shift: tpl.shift
        ? { ...tpl.shift, breaks: tpl.shift.breaks.map(b => ({ ...b })) as [Break, Break, Break] }
        : editFormData.shift,
    });
  };

  const saveAsTemplate = async () => {
    if (!editFormData) return;
    const name = prompt('Template name (e.g. "Morning 8-4"):');
    if (!name || !name.trim()) return;
    try {
      await store.addTemplate({
        id: crypto.randomUUID(),
        name: name.trim(),
        type: editFormData.type,
        shift: editFormData.shift,
      });
      alert('Template saved.');
    } catch {
      alert('Could not save template.');
    }
  };

  const handleTimeChange = (type: 'start' | 'end', value: string) => {
    if (!editFormData?.shift || !editingDay) return;
    const isBranchEmp = isBranchEmployeeTarget(editingDay.userId);
    const newShift = { ...editFormData.shift };
    if (type === 'start') {
      newShift.startTime = value;
      // Branch employees: end time auto-fills 9 hours later. Dept: 8 hours.
      const startMins = parseMinutes(value);
      const endMins = startMins + (isBranchEmp ? 9 : 8) * 60;
      newShift.endTime = formatMinutes(endMins);
    } else {
      newShift.endTime = value;
    }
    if (isBranchEmp) {
      // Branch managers fill break times manually — never auto-calculate
      // or overwrite whatever they've already entered.
      newShift.breaks = editFormData.shift.breaks;
    } else {
      const offset = getShiftCollisionOffset(editingDay.userId, editingDay.date, newShift.startTime, newShift.endTime);
      newShift.breaks = calculateAutoBreaks(newShift.startTime, newShift.endTime, offset);
    }
    setEditFormData({ ...editFormData, shift: newShift });
  };

  const handleBreakChange = (index: number, field: 'start' | 'end', value: string) => {
    if (!editFormData?.shift) return;
    const newBreaks = [...editFormData.shift.breaks] as [Break, Break, Break];
    newBreaks[index] = { ...newBreaks[index], [field]: value };
    setEditFormData({
      ...editFormData,
      shift: { ...editFormData.shift, breaks: newBreaks }
    });
  };

  const handleEditDay = (userId: string, date: string, existing?: ScheduleDay) => {
    setEditingDay({ userId, date });
    setApplyToWeek(false);
    setSelectedWeekDays([]);
    const isBranchEmp = isBranchEmployeeTarget(userId);
    const defaultStart = '08:00';
    const defaultEnd = isBranchEmp ? formatMinutes(parseMinutes(defaultStart) + 9 * 60) : '16:00';
    if (existing) {
      setEditFormData(existing);
    } else {
      setEditFormData({
        id: Math.random().toString(),
        date,
        type: DayType.NORMAL_SHIFT,
        minutes: 0,
        shift: {
          startTime: defaultStart,
          endTime: defaultEnd,
          breaks: isBranchEmp
            ? emptyBreaks()
            : calculateAutoBreaks(defaultStart, defaultEnd, getShiftCollisionOffset(userId, date, defaultStart, defaultEnd))
        }
      });
    }
  };

  const saveDay = async () => {
    if (!editingDay || !editFormData) return;

    // --- Conflict prevention (warn, allow override) ---
    const newType = editFormData.type;
    const workingTypes = [DayType.NORMAL_SHIFT, DayType.WORK_FROM_HOME, DayType.TASK, DayType.TARDY, DayType.EARLY_LEAVE, DayType.DELAY_WAS_PERMISSION, DayType.CANCEL_OFF];

    // 1) Scheduling a shift on a day the employee has an APPROVED leave.
    if (workingTypes.includes(newType)) {
      const appr = leaveRequests.find(l =>
        l.userId === editingDay.userId && l.date === editingDay.date && l.status === LeaveStatus.APPROVED
      );
      if (appr && !confirm(`This employee has an APPROVED ${dayTypeLabel(appr.type)} on ${editingDay.date}.\nSchedule a shift anyway?`)) {
        return;
      }
    }

    // 2) Annual leave that exceeds the remaining balance.
    if (newType === DayType.ANNUAL_LEAVE) {
      const emp = employees.find(e => e.id === editingDay.userId);
      const sched = allSchedules[editingDay.userId] || {};
      const takenElsewhere = Object.entries(sched)
        .filter(([d, day]) => d !== editingDay.date && day.type === DayType.ANNUAL_LEAVE).length;
      const remaining = (emp?.annualBalance || 0) - takenElsewhere;
      if (remaining <= 0 && !confirm(`${emp?.name || 'This employee'} has no remaining annual balance (used ${takenElsewhere}/${emp?.annualBalance || 0}).\nApprove this annual leave anyway?`)) {
        return;
      }
    }

    setIsSaving(true);
    try {
      // NOTE: Leave balances are NOT mutated here. "Taken" days are derived by
      // counting ANNUAL_LEAVE / PUBLIC_HOLIDAY entries in the schedule, and the
      // remaining balance is computed as (entitlement - taken). Decrementing the
      // stored balance here as well would double-count every leave day.

      if (applyToWeek) {
        const batchMap: Record<string, ScheduleDay> = {};
        const indicesToApply = selectedWeekDays.length > 0 ? selectedWeekDays : [0, 1, 2, 3, 4, 5, 6];
        
        indicesToApply.forEach(idx => {
          const targetDate = format(weekDays[idx], 'yyyy-MM-dd');
          batchMap[targetDate] = { 
            ...editFormData, 
            id: Math.random().toString(), 
            date: targetDate 
          };
        });
        
        await store.updateBatchDays(editingDay.userId, batchMap);
      } else {
        await store.updateDay(editingDay.userId, editingDay.date, editFormData);
      }
      
      const data = await store.getCurrentAppData();
      setAllSchedules(data.schedules);
      setEditingDay(null);
    } catch (err) {
      alert('Error saving roster');
    } finally {
      setIsSaving(false);
    }
  };

  const toggleWeekDay = (idx: number) => {
    setSelectedWeekDays(prev => 
      prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx]
    );
  };

  const handleClearWeek = async () => {
    setIsSaving(true);
    try {
      const datesToClear = weekDays.map(d => format(d, 'yyyy-MM-dd'));
      const userIds = Object.keys(allSchedules);
      
      // Iterate through all users and clear their schedules for these dates
      for (const userId of userIds) {
        const userSchedule = allSchedules[userId];
        const hasShiftsInWeek = datesToClear.some(date => userSchedule[date]);
        
        if (hasShiftsInWeek) {
          await store.clearBatchDays(userId, datesToClear);
        }
      }
      
      const appData = await store.getCurrentAppData();
      setAllSchedules(appData.schedules);
      setShowClearWeekModal(false);
      alert('Current week shifts cleared successfully!');
    } catch (error) {
      console.error("Error clearing week:", error);
      alert('Error clearing week shifts. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopyLastWeek = async () => {
    const ids = filteredEmployees.map(e => e.id);
    if (ids.length === 0) {
      alert('No employees in the current view to copy.');
      return;
    }
    const fromStart = format(addDays(currentWeekStart, -7), 'yyyy-MM-dd');
    const toStart = format(currentWeekStart, 'yyyy-MM-dd');
    if (!confirm(`Copy last week's schedule for ${ids.length} employee(s) in view into the current week?\n\nDays where last week had a shift will overwrite this week.`)) return;
    setIsSaving(true);
    try {
      const copied = await store.copyWeek(fromStart, toStart, ids);
      const data = await store.getCurrentAppData();
      setAllSchedules(data.schedules);
      alert(`Copied ${copied} day(s) from last week into this week.`);
    } catch (err) {
      console.error('Copy last week failed:', err);
      alert('Error copying last week.');
    } finally {
      setIsSaving(false);
    }
  };

  const startListening = () => {
    const SR = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SR) { setAiError('Voice input needs Chrome/Edge. You can type instead.'); return; }
    const rec = new SR();
    rec.lang = 'ar-EG';
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e: any) => {
      let txt = '';
      for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript;
      setAiText(txt);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    try { rec.start(); } catch { setListening(false); }
  };
  const stopListening = () => { try { recognitionRef.current?.stop(); } catch { /* ignore */ } setListening(false); };

  const analyzeAi = async () => {
    if (!aiText.trim()) return;
    stopListening();
    setAiBusy(true); setAiError(''); setAiResult(null);
    try {
      const res = await store.parseSchedule(aiText.trim(), format(currentWeekStart, 'yyyy-MM-dd'));
      setAiResult(res);
    } catch (e: any) {
      setAiError(String(e?.message || '').includes('503') ? 'AI scheduling is not configured yet.' : 'Could not analyze — try rephrasing.');
    } finally {
      setAiBusy(false);
    }
  };

  const saveAi = async () => {
    if (!aiResult) return;
    setIsSaving(true);
    try {
      const shiftTypes = [DayType.NORMAL_SHIFT, DayType.WORK_FROM_HOME, DayType.TASK, DayType.TARDY, DayType.EARLY_LEAVE, DayType.DELAY_WAS_PERMISSION];
      const batch: Record<string, ScheduleDay> = {};
      aiResult.days.forEach(d => {
        const type = (DayType as any)[d.type] ? (d.type as DayType) : DayType.DAY_OFF;
        const day: ScheduleDay = { id: crypto.randomUUID(), date: d.date, type };
        if (shiftTypes.includes(type) && d.startTime && d.endTime) {
          const offset = getShiftCollisionOffset(aiResult.employeeId, d.date, d.startTime, d.endTime);
          day.shift = { startTime: d.startTime, endTime: d.endTime, breaks: calculateAutoBreaks(d.startTime, d.endTime, offset) };
        }
        batch[d.date] = day;
      });
      await store.updateBatchDays(aiResult.employeeId, batch);
      const data = await store.getCurrentAppData();
      setAllSchedules(data.schedules);
      setShowAiModal(false); setAiResult(null); setAiText('');
      alert(`Schedule saved for ${aiResult.employeeName}.`);
    } catch {
      setAiError('Error saving schedule.');
    } finally {
      setIsSaving(false);
    }
  };

  // Parses "H:MM - H:MM", tolerating an optional AM/PM suffix on either
  // side independently (Excel auto-formats typed times, so a bulk-upload
  // cell can come back as "19:00", "7:00 PM", or "10:00 - 07:00 PM").
  // A side with no AM/PM is treated as already 24-hour. Returns null if
  // the cell doesn't match at all.
  const parseTimeRange = (val: string): { start: string; end: string } | null => {
    const m = val.match(/^(\d{1,2}:\d{2}\s*(?:[AaPp][Mm])?)\s*-\s*(\d{1,2}:\d{2}\s*(?:[AaPp][Mm])?)$/);
    if (!m) return null;
    const to24 = (t: string): string | null => {
      const mm = t.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])?$/);
      if (!mm) return null;
      let h = parseInt(mm[1], 10);
      const min = mm[2];
      const ap = mm[3]?.toUpperCase();
      if (h > 23 || parseInt(min, 10) > 59) return null;
      if (ap === 'PM' && h !== 12) h += 12;
      if (ap === 'AM' && h === 12) h = 0;
      if (h > 23) return null;
      return `${String(h).padStart(2, '0')}:${min}`;
    };
    const start = to24(m[1]);
    const end = to24(m[2]);
    return start && end ? { start, end } : null;
  };

  // Downloads a template matching exactly what handleBulkUpload parses:
  // col A = Employee ID, col B = Name (reference only), cols C-I = the 7
  // days of the currently selected week, pre-filled with each employee's
  // row so the manager only has to type in the shift cells.
  const downloadBulkTemplate = () => {
    const header = ['Employee ID', 'Name', ...weekDays.map(d => format(d, 'EEEE'))];
    // One example row showing every accepted cell format — delete it before
    // uploading. Each column demonstrates a different value so the manager
    // can see the exact spelling/format the parser expects.
    const exampleRow = [
      'DELETE ME', '↓ EXAMPLE — delete this row before uploading ↓',
      '08:00 - 16:00', 'OFF', 'ABSENT', 'SICK', 'ANNUAL', 'PUBLIC', 'WFH',
    ];
    const rows = filteredEmployees.map(emp => [emp.employeeId || emp.id, emp.name, '', '', '', '', '', '', '']);
    const allRows = [header, exampleRow, ...rows];
    const worksheet = XLSX.utils.aoa_to_sheet(allRows);
    worksheet['!cols'] = [{ wch: 16 }, { wch: 38 }, ...Array(7).fill({ wch: 16 })];
    // Force the 7 shift columns (C-I) to Text format on every row, including
    // still-blank ones — otherwise Excel silently reinterprets whatever gets
    // typed later (e.g. "19:00") as a time value and redisplays it in the
    // system's default clock format (often 12h with AM/PM), which then fails
    // to parse back on upload.
    for (let r = 0; r < allRows.length; r++) {
      for (let c = 2; c <= 8; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        if (worksheet[addr]) {
          worksheet[addr].z = '@';
        } else {
          worksheet[addr] = { t: 's', v: '', z: '@' };
        }
      }
    }
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Bulk Upload Template');
    XLSX.writeFile(workbook, `Swipr_Bulk_Template_${format(weekDays[0], 'yyyy-MM-dd')}.xlsx`);
  };

  const handleBulkUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        // Use header: 1 to get a 2D array (rows as arrays)
        const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];

        if (data.length < 2) {
          alert('Excel file is empty or missing data rows.');
          return;
        }

        setBulkUploadProgress({ current: 0, total: data.length - 1, errors: [] });
        setIsSaving(true);

        const errors: string[] = [];
        let processedCount = 0;
        const batchUpdates: Record<string, Record<string, ScheduleDay>> = {};

        // Skip the first row (headers)
        for (let rowIndex = 1; rowIndex < data.length; rowIndex++) {
          const row = data[rowIndex];
          const empId = row[0]?.toString().trim();
          
          if (!empId) {
            processedCount++;
            continue; // Skip empty rows
          }

          const employee = employees.find(emp => emp.employeeId === empId || emp.id === empId);
          if (!employee) {
            errors.push(`Row ${rowIndex + 1}: Employee ID "${empId}" not found in system`);
            processedCount++;
            continue;
          }

          // Process Sunday (index 2) to Saturday (index 8)
          for (let i = 0; i < 7; i++) {
            const cellValue = row[i + 2]?.toString().trim();
            const targetDate = format(weekDays[i], 'yyyy-MM-dd');

            if (!cellValue) continue;

            let dayData: ScheduleDay;
            // A trailing "C.OFF" / "C.OOF" / "CANCEL OFF" marker after the
            // time range means this shift is a Cancel Off, not a normal one.
            // Tolerant of "OFF" typos (extra/missing O's or F's, e.g. "C.OOF"
            // instead of "C.OFF") — any run of O's followed by any run of F's.
            const cancelOffMarker = /\s*(?:c\.?\s*o+f+|cancel\s*o+f+)\s*$/i;
            const isCancelOff = cancelOffMarker.test(cellValue);
            const timeOnly = cellValue.replace(cancelOffMarker, '').trim();
            // Excel auto-formats typed times, so cells can come back as
            // "19:00", "7:00 PM", or a mix of both sides — accept an
            // optional AM/PM per side and normalize to 24h.
            const timeRange = parseTimeRange(timeOnly);
            const upperVal = cellValue.toUpperCase();

            if (upperVal === 'OFF') {
              dayData = {
                id: Math.random().toString(36).substr(2, 9),
                date: targetDate,
                type: DayType.DAY_OFF
              };
            } else if (upperVal === 'ABSENT') {
              dayData = {
                id: Math.random().toString(36).substr(2, 9),
                date: targetDate,
                type: DayType.ABSENT
              };
            } else if (upperVal === 'PUBLIC' || upperVal === 'PUBLIC HOLIDAY') {
              dayData = {
                id: Math.random().toString(36).substr(2, 9),
                date: targetDate,
                type: DayType.PUBLIC_HOLIDAY
              };
            } else if (upperVal === 'SICK') {
              dayData = {
                id: Math.random().toString(36).substr(2, 9),
                date: targetDate,
                type: DayType.SICK
              };
            } else if (upperVal === 'ANNUAL' || upperVal === 'ANNUAL LEAVE') {
              dayData = {
                id: Math.random().toString(36).substr(2, 9),
                date: targetDate,
                type: DayType.ANNUAL_LEAVE
              };
            } else if (upperVal === 'WFH' || upperVal === 'WORK FROM HOME') {
              dayData = {
                id: Math.random().toString(36).substr(2, 9),
                date: targetDate,
                type: DayType.WORK_FROM_HOME
              };
            } else if (timeRange) {
              const { start: startTime, end: endTime } = timeRange;

              const breaks: Break[] = Array(3).fill(null).map(() => ({
                id: Math.random().toString(36).substr(2, 9),
                start: '',
                end: ''
              }));

              dayData = {
                id: Math.random().toString(36).substr(2, 9),
                date: targetDate,
                type: isCancelOff ? DayType.CANCEL_OFF : DayType.NORMAL_SHIFT,
                shift: {
                  startTime,
                  endTime,
                  breaks: breaks as [Break, Break, Break]
                }
              };
            } else {
              errors.push(`Row ${rowIndex + 1}, Day ${i + 1}: Invalid format "${cellValue}". Expected "HH:mm - HH:mm" (24h or AM/PM), optionally followed by "C.OFF", or "OFF"`);
              continue;
            }

            if (!batchUpdates[employee.id]) {
              batchUpdates[employee.id] = {};
            }
            batchUpdates[employee.id][targetDate] = dayData;
          }
          
          processedCount++;
          setBulkUploadProgress(prev => prev ? { ...prev, current: processedCount } : null);
        }

        // Apply batch updates to Firestore
        for (const [userId, batch] of Object.entries(batchUpdates)) {
          await store.updateBatchDays(userId, batch);
        }

        const appData = await store.getCurrentAppData();
        setAllSchedules(appData.schedules);
        
        setBulkUploadProgress(prev => prev ? { ...prev, errors } : null);
        if (errors.length === 0) {
          alert('Bulk upload completed successfully for the current week!');
          setShowBulkUploadModal(false);
          setBulkUploadProgress(null);
        }
      } catch (err) {
        console.error('Error processing bulk upload:', err);
        alert('Error processing file. Please check the format.');
      } finally {
        setIsSaving(false);
      }
    };
    reader.readAsBinaryString(file);
  };

  const exportToExcel = () => {
    const dataToExport: any[] = [];
    filteredEmployees.forEach(emp => {
      displayedDays.forEach(day => {
        const dateStr = format(day, 'yyyy-MM-dd');
        const dayData = (allSchedules[emp.id] || {})[dateStr];
        const isOffDay = !dayData || [DayType.DAY_OFF, DayType.ABSENT, DayType.PUBLIC_HOLIDAY, DayType.ANNUAL_LEAVE, DayType.SICK].includes(dayData.type);

        dataToExport.push({
          'Day': format(day, 'EEEE'),
          'Date': dateStr,
          'ID': emp.employeeId || 'N/A',
          'Employee Name': emp.name,
          'Company': unitOf(emp) || 'Swipr',
          'Type': dayData?.type || 'DAY_OFF',
          'Start Time': isOffDay ? '--:--' : (dayData?.shift?.startTime || '--:--'),
          'End Time': isOffDay ? '--:--' : (dayData?.shift?.endTime || '--:--')
        });
      });
    });
    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    const sheetName = selectedDayIndex === 'all' ? 'Weekly Roster' : format(displayedDays[0], 'EEEE dd');
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    const fileName = selectedDayIndex === 'all' 
      ? `Swipr_Export_Week_${format(currentWeekStart, 'yyyy-MM-dd')}.xlsx`
      : `Swipr_Export_Day_${format(displayedDays[0], 'yyyy-MM-dd')}.xlsx`;
    XLSX.writeFile(workbook, fileName);
  };

  const exportRangeToExcel = () => {
    const dataToExport: any[] = [];
    const start = new Date(exportStartDate);
    const end = new Date(exportEndDate);
    
    // Generate all days in range
    const daysInRange: Date[] = [];
    let current = new Date(start);
    while (current <= end) {
      daysInRange.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }

    filteredEmployees.forEach(emp => {
      daysInRange.forEach(day => {
        const dateStr = format(day, 'yyyy-MM-dd');
        const dayData = (allSchedules[emp.id] || {})[dateStr];
        const isOffDay = !dayData || [DayType.DAY_OFF, DayType.ABSENT, DayType.PUBLIC_HOLIDAY, DayType.ANNUAL_LEAVE, DayType.SICK].includes(dayData.type);

        dataToExport.push({
          'Day': format(day, 'EEEE'),
          'Date': dateStr,
          'ID': emp.employeeId || 'N/A',
          'Employee Name': emp.name,
          'Company': unitOf(emp) || 'Swipr',
          'Type': dayData?.type || 'DAY_OFF',
          'Start Time': isOffDay ? '--:--' : (dayData?.shift?.startTime || '--:--'),
          'End Time': isOffDay ? '--:--' : (dayData?.shift?.endTime || '--:--')
        });
      });
    });

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Range Roster');
    const fileName = `Swipr_Export_Range_${exportStartDate}_to_${exportEndDate}.xlsx`;
    XLSX.writeFile(workbook, fileName);
    setShowRangeExportModal(false);
  };

  const getEmployeeSummary = (empId: string) => {
    const empSchedules = allSchedules[empId] || {};
    const summary = {
      [DayType.ANNUAL_LEAVE]: [] as string[],
      [DayType.SICK]: [] as string[],
      [DayType.PUBLIC_HOLIDAY]: [] as string[],
      [DayType.ABSENT]: [] as string[],
      [DayType.DAY_OFF]: [] as string[],
      [DayType.TARDY]: [] as string[],
      [DayType.EARLY_LEAVE]: [] as string[],
      [DayType.TRAINING]: [] as string[],
      [DayType.DELAY_WAS_PERMISSION]: [] as string[],
      [DayType.OFF_SET]: [] as string[],
      [DayType.CANCEL_OFF]: [] as string[],
    };

    Object.entries(empSchedules).forEach(([date, data]) => {
      // Date range filter
      if (summaryStartDate && date < summaryStartDate) return;
      if (summaryEndDate && date > summaryEndDate) return;

      if (summary[data.type as keyof typeof summary]) {
        summary[data.type as keyof typeof summary].push(date);
      }
    });

    return summary;
  };

  const addHistoricalDay = async () => {
    if (!selectedEmployeeSummary) return;
    setIsSaving(true);
    try {
      const newDay: ScheduleDay = {
        id: Math.random().toString(36).substr(2, 9),
        date: historicalDate,
        type: historicalType,
      };
      
      await store.updateDay(selectedEmployeeSummary.id, historicalDate, newDay);
      const data = await store.getCurrentAppData();
      setAllSchedules(data.schedules);
      // Reset date to today for next entry
      setHistoricalDate(format(new Date(), 'yyyy-MM-dd'));
    } catch (error) {
      console.error('Error adding historical day:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const renderDayCell = (empId: string, dateStr: string, dayData: ScheduleDay | undefined, isCompact: boolean = false) => {
    const isNormal = dayData?.type === DayType.NORMAL_SHIFT;
    const isWFH = dayData?.type === DayType.WORK_FROM_HOME;
    const isTask = dayData?.type === DayType.TASK;
    const isTardy = dayData?.type === DayType.TARDY;
    const isEarly = dayData?.type === DayType.EARLY_LEAVE;
    const isDelayPermission = dayData?.type === DayType.DELAY_WAS_PERMISSION;
    const isCancelOff = dayData?.type === DayType.CANCEL_OFF;
    const isOff = !dayData || dayData.type === DayType.DAY_OFF;

    const baseClasses = `p-4 rounded-[24px] border-2 cursor-pointer transition-all hover:scale-[1.02] flex flex-col justify-between`;
    const themeClasses = isNormal ? 'bg-blue-50/30 border-blue-100 hover:border-blue-400' :
                        isWFH ? 'bg-indigo-50/30 border-indigo-100 hover:border-indigo-400' :
                        isTask ? 'bg-purple-50/30 border-purple-100 hover:border-purple-400' :
                        isDelayPermission ? 'bg-teal-50/30 border-teal-100 hover:border-teal-400' :
                        isCancelOff ? 'bg-amber-50/30 border-amber-100 hover:border-amber-400' :
                        isOff ? 'bg-gray-50/50 border-transparent hover:border-gray-200' :
                        dayData?.type === DayType.OFF_SET ? 'bg-slate-50/50 border-transparent hover:border-slate-200' :
                        'bg-orange-50/30 border-orange-100 hover:border-orange-400';

    return (
      <div
        onClick={() => handleEditDay(empId, dateStr, dayData)}
        className={`${baseClasses} ${themeClasses} ${isCompact ? 'min-h-0 py-3' : 'min-h-[160px]'}`}
      >
        {(isNormal || isWFH || isTask || isTardy || isEarly || isDelayPermission || isCancelOff) ? (
          <div className={`${isCompact ? 'flex items-center justify-between w-full' : 'space-y-4'}`}>
            <div className="space-y-0.5">
              <p className={`text-[10px] font-black uppercase tracking-widest ${isTask ? 'text-purple-600' : isTardy ? 'text-indigo-600' : isDelayPermission ? 'text-teal-600' : isCancelOff ? 'text-amber-600' : isEarly ? 'text-rose-600' : isWFH ? 'text-indigo-600' : 'text-blue-600'}`}>
                {isWFH ? 'WFH' : isTask ? `Task (${dayData.minutes}m)` : isTardy ? `Late (${dayData.minutes}m)` : isDelayPermission ? `Late Perm. (${dayData.minutes}m)` : isCancelOff ? 'Cancel Off' : isEarly ? `Leave Perm. (${dayData.minutes}m)` : 'Shift'}
              </p>
              <p className={`${isCompact ? 'text-xs' : 'text-sm'} font-black text-gray-900`}>{dayData.shift?.startTime} - {dayData.shift?.endTime}</p>
            </div>
            {!isCompact && (
              <div className="space-y-1.5 pt-2 border-t border-gray-100/50">
                {/* Skip breaks the manager hasn't set (blank or zero-length). */}
                {dayData.shift?.breaks?.filter(br => br.start && br.start !== br.end).map((br, idx) => (
                  <div key={idx} className="flex justify-between items-center">
                    <span className="text-[9px] font-black text-gray-400 uppercase">Br {idx + 1}</span>
                    <span className="text-[10px] font-bold text-gray-500">{br.start}</span>
                  </div>
                ))}
                {!!dayData.overtimeHours && (
                  <div className="flex justify-between items-center">
                    <span className="text-[9px] font-black text-violet-500 uppercase">Overtime</span>
                    <span className="text-[10px] font-black text-violet-700">{dayData.overtimeHours}h</span>
                  </div>
                )}
              </div>
            )}
            {isCompact && (
               <div className="flex gap-3">
                  {dayData.shift?.breaks?.filter(br => br.start && br.start !== br.end).map((br, idx) => (
                    <div key={idx} className="flex items-center gap-1">
                      <Coffee size={10} className="text-gray-300" />
                      <span className="text-[9px] font-bold text-gray-400">{br.start}</span>
                    </div>
                  ))}
                  {!!dayData.overtimeHours && (
                    <div className="flex items-center gap-1">
                      <Timer size={10} className="text-violet-400" />
                      <span className="text-[9px] font-black text-violet-600">{dayData.overtimeHours}h OT</span>
                    </div>
                  )}
               </div>
            )}
          </div>
        ) : isOff ? (
          <div className={`flex-1 flex flex-col items-center justify-center ${isCompact ? 'flex-row gap-2' : 'space-y-2'} opacity-40`}>
            <Moon size={isCompact ? 14 : 24} className="text-gray-400" />
            <span className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Day Off</span>
          </div>
        ) : dayData.type === DayType.PUBLIC_HOLIDAY ? (
          <div className={`flex-1 flex flex-col items-center justify-center ${isCompact ? 'flex-row gap-2' : 'space-y-2'}`}>
            <Star size={isCompact ? 14 : 24} className="text-orange-600" />
            <span className="text-[10px] font-black text-orange-600 uppercase tracking-[0.2em]">Public Holiday</span>
          </div>
        ) : dayData.type === DayType.ANNUAL_LEAVE ? (
          <div className={`flex-1 flex flex-col items-center justify-center ${isCompact ? 'flex-row gap-2' : 'space-y-2'}`}>
            <Palmtree size={isCompact ? 14 : 24} className="text-emerald-600" />
            <span className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.2em]">Annual Leave</span>
          </div>
        ) : dayData.type === DayType.SICK ? (
          <div className={`flex-1 flex flex-col items-center justify-center ${isCompact ? 'flex-row gap-2' : 'space-y-2'}`}>
            <Thermometer size={isCompact ? 14 : 24} className="text-rose-600" />
            <span className="text-[10px] font-black text-rose-600 uppercase tracking-[0.2em]">Sick</span>
          </div>
        ) : dayData.type === DayType.TRAINING ? (
          <div className={`flex-1 flex flex-col items-center justify-center ${isCompact ? 'flex-row gap-2' : 'space-y-2'}`}>
            <GraduationCap size={isCompact ? 14 : 24} className="text-indigo-600" />
            <span className="text-[10px] font-black text-indigo-600 uppercase tracking-[0.2em]">Training</span>
          </div>
        ) : dayData.type === DayType.OFF_SET ? (
          <div className={`flex-1 flex flex-col items-center justify-center ${isCompact ? 'flex-row gap-2' : 'space-y-2'} opacity-60`}>
            <Moon size={isCompact ? 14 : 24} className="text-slate-500" />
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Off Set</span>
          </div>
        ) : (
          <div className={`${isCompact ? 'flex items-center justify-between w-full' : 'space-y-4'}`}>
            <p className="text-[10px] font-black text-orange-600 uppercase tracking-widest">{dayTypeLabel(dayData.type)}</p>
            <p className={`${isCompact ? 'text-xs' : 'text-sm'} font-black text-gray-900`}>{dayData.shift?.startTime || '--:--'} - {dayData.shift?.endTime || '--:--'}</p>
          </div>
        )}
      </div>
    );
  };

  const filteredEmployees = employees.filter(e => {
    const matchesSearch = e.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          e.jobTitle?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          e.employeeId?.toLowerCase().includes(searchQuery.toLowerCase());
    
    // A department selection shows its agents only (team leaders have their
    // own dedicated entry); the Brand/Branch cascade narrows the
    // field-operations hierarchy independently of the department filter.
    const matchesFilter = selectedCompany === 'All' ||
      (selectedCompany === TEAM_LEADERS_FILTER
        ? e.role === UserRole.MANAGER
        : (unitOf(e).trim().toLowerCase() === selectedCompany.toLowerCase() &&
           (isBranchRole(e.role) || e.role === UserRole.EMPLOYEE)));

    const matchesBrand = selectedBrand === 'All' ||
      ((e.brand || '').trim().toLowerCase() === selectedBrand.toLowerCase() &&
       (selectedBranch === 'All' || (e.branch || '').trim().toLowerCase() === selectedBranch.toLowerCase()));

    const matchesTeamLeader = selectedTeamLeader === 'All' ||
                              normalizeTL(e.teamLeader) === normalizeTL(selectedTeamLeader);

    return matchesSearch && matchesFilter && matchesBrand && matchesTeamLeader;
  }).sort((a, b) => {
    // Managers (team leaders / branch & area managers) on top; otherwise
    // keep the original order (stable sort).
    const rank = (r: UserRole) => (ELEVATED_ROLES.includes(r) ? 0 : 1);
    return rank(a.role) - rank(b.role);
  });

  return (
    <div className="max-w-[1600px] mx-auto space-y-8 pb-24 animate-in fade-in duration-500">
      <div className="bg-white p-5 md:p-8 rounded-[32px] border border-gray-100 shadow-sm space-y-6">
        {/* Row 1: Title + week navigation */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl md:text-3xl font-black text-gray-900 tracking-tight">{t('scheduleMgmt.title')}</h1>
              {isTop && (
                <span className="flex items-center gap-1.5 px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-[10px] font-black uppercase tracking-widest border border-purple-200">
                  <ShieldCheck size={12} />
                  {currentUser?.role === UserRole.ADMIN ? 'Admin Access' : 'Supervisor Access'}
                </span>
              )}
              {branchViewer && (
                <span className="flex items-center gap-1.5 px-3 py-1 bg-emerald-100 text-emerald-700 rounded-full text-[10px] font-black uppercase tracking-widest border border-emerald-200">
                  <ShieldCheck size={12} />
                  {roleLabel(currentUser?.role)} · {unitOf(currentUser || undefined)}
                </span>
              )}
            </div>
            <p className="text-gray-400 font-medium text-sm mt-1">Manage team shifts and attendance globally.</p>
          </div>

          <div className="flex bg-gray-50 border border-gray-200 rounded-2xl p-1 self-start md:self-auto">
            <button onClick={() => setCurrentWeekStart(addDays(currentWeekStart, -7))} className="p-2 hover:bg-white hover:shadow-sm rounded-xl text-gray-400 transition-all"><ChevronLeft size={18} /></button>
            <div className="px-3 sm:px-6 font-black text-gray-800 text-[11px] sm:text-xs min-w-[150px] sm:min-w-[200px] text-center flex items-center justify-center uppercase tracking-widest">
              {format(currentWeekStart, 'MMM d')} - {format(addDays(currentWeekStart, 6), 'MMM d, yyyy')}
            </div>
            <button onClick={() => setCurrentWeekStart(addDays(currentWeekStart, 7))} className="p-2 hover:bg-white hover:shadow-sm rounded-xl text-gray-400 transition-all"><ChevronRight size={18} /></button>
          </div>
        </div>

        {/* Row 2: Filters + search + date range */}
        <div className="flex flex-col xl:flex-row xl:items-center gap-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:flex xl:flex-wrap items-stretch gap-3 flex-1">
            {(isTop || branchViewer) && (
              <div className="relative group w-full xl:w-auto">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-500 pointer-events-none">
                  <Building2 size={16} />
                </div>
                <select
                  value={selectedCompany}
                  onChange={(e) => {
                    setSelectedCompany(e.target.value);
                    if (e.target.value !== 'All') { setSelectedBrand('All'); setSelectedBranch('All'); }
                  }}
                  className="w-full xl:w-auto pl-10 pr-10 py-3 bg-gray-50 border border-gray-100 rounded-2xl font-black text-[10px] uppercase tracking-widest outline-none focus:ring-4 focus:ring-blue-500/10 appearance-none xl:min-w-[160px] cursor-pointer"
                >
                  {filterOptions.map(c => (
                    <option key={c} value={c}>
                      {c === 'All'
                        ? (branchViewer ? 'All Branches' : 'All Companies')
                        : c === TEAM_LEADERS_FILTER ? '★ Team Leaders'
                        : deptCompanies.has(c) ? `${c} Agents` : c}
                    </option>
                  ))}
                </select>
                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-300 pointer-events-none">
                  <Filter size={12} />
                </div>
              </div>
            )}

            {currentUser?.role === UserRole.ADMIN && (
              <>
                <div className="relative group w-full xl:w-auto">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-purple-500 pointer-events-none">
                    <Building2 size={16} />
                  </div>
                  <select
                    value={selectedBrand}
                    onChange={(e) => {
                      setSelectedBrand(e.target.value);
                      setSelectedBranch('All');
                      if (e.target.value !== 'All') setSelectedCompany('All');
                    }}
                    className="w-full xl:w-auto pl-10 pr-10 py-3 bg-gray-50 border border-gray-100 rounded-2xl font-black text-[10px] uppercase tracking-widest outline-none focus:ring-4 focus:ring-purple-500/10 appearance-none xl:min-w-[160px] cursor-pointer"
                  >
                    <option value="All">All Brands</option>
                    {BRAND_NAMES.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-300 pointer-events-none">
                    <Filter size={12} />
                  </div>
                </div>
                {selectedBrand !== 'All' && (
                  <div className="relative group w-full xl:w-auto">
                    <select
                      value={selectedBranch}
                      onChange={(e) => setSelectedBranch(e.target.value)}
                      className="w-full xl:w-auto pl-4 pr-10 py-3 bg-gray-50 border border-gray-100 rounded-2xl font-black text-[10px] uppercase tracking-widest outline-none focus:ring-4 focus:ring-purple-500/10 appearance-none xl:min-w-[160px] cursor-pointer"
                    >
                      <option value="All">All Branches</option>
                      {(BRANDS[selectedBrand] || []).map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </div>
                )}
              </>
            )}

            {isTop && (
              <div className="relative group w-full xl:w-auto">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-emerald-500 pointer-events-none">
                  <Users size={16} />
                </div>
                <select
                  value={selectedTeamLeader}
                  onChange={(e) => setSelectedTeamLeader(e.target.value)}
                  className="w-full xl:w-auto pl-10 pr-10 py-3 bg-gray-50 border border-gray-100 rounded-2xl font-black text-[10px] uppercase tracking-widest outline-none focus:ring-4 focus:ring-blue-500/10 appearance-none xl:min-w-[160px] cursor-pointer"
                >
                  {teamLeaders.map(tl => (
                    <option key={tl} value={tl}>{tl === 'All' ? 'All Team Leaders' : tl}</option>
                  ))}
                </select>
                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-300 pointer-events-none">
                  <Filter size={12} />
                </div>
              </div>
            )}

            <div className="relative group w-full sm:col-span-2 xl:col-span-1 xl:flex-1 xl:min-w-[220px]">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={18} />
              <input
                type="text"
                placeholder="Search by name or ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-12 pr-4 py-3 rounded-2xl bg-gray-50 border border-gray-100 text-gray-900 focus:ring-4 focus:ring-blue-500/10 focus:bg-white outline-none text-sm font-medium placeholder:text-gray-400 transition-all"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-2xl p-1 shrink-0 w-full xl:w-auto">
            <div className="flex items-center gap-2 px-3 py-1 w-full justify-center xl:justify-start">
              <Filter size={14} className="text-gray-400 shrink-0" />
              <div className="flex items-center gap-1">
                <input
                  type="date"
                  value={mainStartDate}
                  onChange={(e) => setMainStartDate(e.target.value)}
                  className="bg-transparent border-none text-[9px] font-black uppercase outline-none w-[105px] cursor-pointer"
                  title="Start Date"
                />
                <span className="text-gray-300 font-bold">→</span>
                <input
                  type="date"
                  value={mainEndDate}
                  onChange={(e) => setMainEndDate(e.target.value)}
                  className="bg-transparent border-none text-[9px] font-black uppercase outline-none w-[105px] cursor-pointer"
                  title="End Date"
                />
              </div>
              {(mainStartDate || mainEndDate) && (
                <button
                  onClick={() => { setMainStartDate(''); setMainEndDate(''); }}
                  className="p-1.5 hover:bg-white rounded-lg text-rose-500 transition-all shadow-sm shrink-0"
                  title="Clear Range"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Row 3: Supervisor / team leader / field-operations manager actions */}
        {canManageToolbar && (
          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-gray-50">
            <div className="flex items-center gap-2 pt-4">
              <button onClick={exportToExcel} className="flex items-center justify-center p-3 bg-emerald-600 text-white rounded-2xl hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100 active:scale-95" title="Export Current View">
                <FileSpreadsheet size={20} />
              </button>
              <button onClick={() => setShowRangeExportModal(true)} className="flex items-center justify-center p-3 bg-blue-600 text-white rounded-2xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 active:scale-95" title="Export Date Range">
                <Calendar size={20} />
              </button>
              <button
                onClick={() => setShowBulkUploadModal(true)}
                className="flex items-center justify-center p-3 bg-indigo-500 text-white rounded-2xl hover:bg-indigo-600 transition-all shadow-lg shadow-indigo-100 active:scale-95"
                title="Bulk Upload Shifts (Excel)"
              >
                <Upload size={20} />
              </button>
              <button
                onClick={() => setShowClearWeekModal(true)}
                className="flex items-center justify-center p-3 bg-rose-500 text-white rounded-2xl hover:bg-rose-600 transition-all shadow-lg shadow-rose-100 active:scale-95"
                title="Clear Current Week Shifts"
              >
                <Trash2 size={20} />
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-4">
              <button
                onClick={() => { setShowAiModal(true); setAiResult(null); setAiError(''); }}
                className="flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white rounded-2xl hover:from-violet-700 hover:to-fuchsia-700 transition-all shadow-lg shadow-violet-200 active:scale-95 text-[10px] font-black uppercase tracking-widest"
                title="Type or speak a whole week for an employee"
              >
                <Sparkles size={18} />
                <span>AI Schedule</span>
              </button>
              <button
                onClick={handleCopyLastWeek}
                disabled={isSaving}
                className="flex items-center gap-2 px-5 py-3 bg-teal-600 text-white rounded-2xl hover:bg-teal-700 transition-all shadow-lg shadow-teal-100 active:scale-95 text-[10px] font-black uppercase tracking-widest disabled:opacity-50"
                title="Copy last week's schedule into this week"
              >
                <Copy size={18} />
                <span>Copy Last Week</span>
              </button>
              <button
                onClick={() => setShowAllCompanySummary(true)}
                className="flex items-center gap-2 px-5 py-3 bg-gray-900 text-white rounded-2xl hover:bg-black transition-all shadow-lg shadow-gray-200 active:scale-95 text-[10px] font-black uppercase tracking-widest"
              >
                <ClipboardList size={18} />
                <span>All Company Summary</span>
              </button>
              <button
                onClick={() => setShowLeaveBalanceModal(true)}
                className="flex items-center gap-2 px-5 py-3 bg-indigo-600 text-white rounded-2xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 active:scale-95 text-[10px] font-black uppercase tracking-widest"
              >
                <Star size={18} />
                <span>Leave Balance</span>
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col md:flex-row items-center gap-4 mx-auto lg:mx-0">
        <div className="flex items-center gap-2 p-2 bg-white border border-gray-100 rounded-[28px] shadow-sm w-fit max-w-full overflow-x-auto hide-scrollbar">
          {rangeDays ? (
            <div className="flex items-center gap-2 px-6 py-3 bg-blue-50 text-blue-600 rounded-2xl text-[10px] font-black uppercase tracking-widest border border-blue-100">
              <Calendar size={14} /> Custom Range: {rangeDays.length} Days
            </div>
          ) : (
            <>
              <button onClick={() => setSelectedDayIndex('all')} className={`flex items-center gap-2 px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${selectedDayIndex === 'all' ? 'bg-blue-600 text-white shadow-lg shadow-blue-100' : 'text-gray-400 hover:bg-gray-50'}`}>
                <CalendarDays size={14} /> Full Week
              </button>
              <div className="w-px h-6 bg-gray-100 mx-1"></div>
              {dayLabels.map((label, idx) => (
                <button key={label} onClick={() => setSelectedDayIndex(idx)} className={`px-6 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${selectedDayIndex === idx ? 'bg-gray-900 text-white shadow-lg' : 'text-gray-500 hover:bg-gray-50'}`}>
                  {label} {format(weekDays[idx], 'd')}
                </button>
              ))}
            </>
          )}
        </div>

        <div className="flex items-center gap-1 p-1 bg-white border border-gray-100 rounded-2xl shadow-sm">
          {viewMode === 'horizontal' && (
            <button 
              onClick={() => setWeeklyWrap(!weeklyWrap)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl transition-all text-[9px] font-black uppercase tracking-widest ${weeklyWrap ? 'bg-indigo-600 text-white shadow-md' : 'text-gray-400 hover:bg-gray-50'}`}
              title="Wrap Every 7 Days"
            >
              <Rows size={14} />
              <span>{weeklyWrap ? 'Weekly Wrap On' : 'Weekly Wrap Off'}</span>
            </button>
          )}
          <button 
            onClick={() => setViewMode('horizontal')}
            className={`p-2.5 rounded-xl transition-all ${viewMode === 'horizontal' ? 'bg-blue-600 text-white shadow-md' : 'text-gray-400 hover:bg-gray-50'}`}
            title="Horizontal View"
          >
            <Columns size={18} />
          </button>
          <button 
            onClick={() => setViewMode('grid')}
            className={`p-2.5 rounded-xl transition-all ${viewMode === 'grid' ? 'bg-blue-600 text-white shadow-md' : 'text-gray-400 hover:bg-gray-50'}`}
            title="Grid View (7 Columns)"
          >
            <LayoutGrid size={18} />
          </button>
          <button 
            onClick={() => setViewMode('vertical')}
            className={`p-2.5 rounded-xl transition-all ${viewMode === 'vertical' ? 'bg-blue-600 text-white shadow-md' : 'text-gray-400 hover:bg-gray-50'}`}
            title="Vertical View"
          >
            <Rows size={18} />
          </button>
        </div>
      </div>

      <div className="bg-white rounded-[40px] border border-gray-100 shadow-xl shadow-blue-50/20 overflow-hidden">
        {viewMode === 'horizontal' ? (
          /* The roster is taller than the screen, so the dates have to stay
             in view — without them a row halfway down says "10:00-18:00"
             with no way to tell which day it belongs to. Sticky resolves
             against the nearest scrolling ancestor, so this wrapper has to
             BE that scroller (a bounded height, scrolling both ways);
             leaving the page to scroll would pin the header to a scrollport
             as tall as the whole table, which never moves. */
          <div className="overflow-auto max-h-[calc(100vh-15rem)]">
            <table className="w-full min-w-[1200px] border-separate border-spacing-0">
              <thead>
                <tr>
                  {/* Opaque, not the row's bg-gray-50/50 — rows scroll
                      underneath and would otherwise show through. Sticky in
                      both axes so the name column stays put sideways too. */}
                  <th className="sticky top-0 left-0 z-30 bg-[#F7F8FA] border-b border-gray-100 px-8 py-6 text-left text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] w-[300px]">Employee</th>
                  {(!weeklyWrap ? displayedDays : displayedDays.slice(0, 7)).map(day => (
                    <th key={day.toString()} className="sticky top-0 z-20 bg-[#F7F8FA] border-b border-l border-gray-100 px-4 py-6 text-center">
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{format(day, 'EEE')}</p>
                      <p className="text-2xl font-black text-gray-900 mt-1">{format(day, 'd')}</p>
                      {/* The month matters once the range crosses one. */}
                      <p className="text-[9px] font-black text-gray-300 uppercase tracking-widest">{format(day, 'MMM')}</p>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredEmployees.map(emp => {
                  const weeks = [];
                  if (weeklyWrap) {
                    for (let i = 0; i < displayedDays.length; i += 7) {
                      weeks.push(displayedDays.slice(i, i + 7));
                    }
                  } else {
                    weeks.push(displayedDays);
                  }

                  return weeks.map((week, weekIdx) => (
                    <tr key={`${emp.id}-${weekIdx}`} className="group hover:bg-gray-50/30 transition-colors">
                      {/* Held to the left edge so the name stays readable while
                          the week scrolls sideways; opaque for the same reason
                          the header is. */}
                      <td className="sticky left-0 z-10 bg-white group-hover:bg-[#FAFBFC] border-b border-gray-100 px-8 py-8">
                        <div className="flex items-center gap-5">
                          {weekIdx === 0 ? (
                            <>
                              <Avatar
                                name={emp.name}
                                photoUrl={emp.photoUrl}
                                className={`w-14 h-14 rounded-[20px] flex items-center justify-center text-white font-black text-xl shadow-lg overflow-hidden ${ELEVATED_ROLES.includes(emp.role) ? 'bg-purple-600 shadow-purple-200' : 'bg-blue-600 shadow-blue-200'}`}
                              />
                              <div className="space-y-1">
                                <h3 className="text-lg font-black text-gray-900 leading-tight flex items-center gap-2">
                                  {emp.name}
                                  {ELEVATED_ROLES.includes(emp.role) && (
                                    <span className="bg-purple-100 text-purple-700 text-[8px] px-2 py-0.5 rounded-md font-black uppercase tracking-wider shrink-0">{roleLabel(emp.role)}</span>
                                  )}
                                </h3>
                                <div className="flex flex-col gap-1">
                                  <span className="flex items-center gap-1.5 text-[9px] font-black text-blue-600 uppercase tracking-wider"><Briefcase size={10} /> {emp.jobTitle || 'CSR'}</span>
                                  <span className="flex items-center gap-1.5 text-[9px] font-bold text-gray-400 uppercase tracking-wider"><Building2 size={10} /> {unitOf(emp) || 'Swipr'}</span>
                                  {emp.teamLeader && (
                                    <span className="flex items-center gap-1.5 text-[9px] font-bold text-emerald-600 uppercase tracking-wider"><Users size={10} /> TL: {emp.teamLeader}</span>
                                  )}
                                  <button 
                                    onClick={() => setSelectedEmployeeSummary(emp)}
                                    className="mt-2 flex items-center gap-1.5 text-[9px] font-black text-white bg-gray-900 px-3 py-1.5 rounded-lg uppercase tracking-wider hover:bg-black transition-all shadow-sm active:scale-95 w-fit"
                                  >
                                    <ClipboardList size={10} /> View Summary
                                  </button>
                                </div>
                              </div>
                            </>
                          ) : (
                            <div className="flex items-center gap-3 pl-14">
                              <span className="text-[10px] font-black text-gray-300 uppercase tracking-widest">Week {weekIdx + 1}</span>
                              <div className="h-px w-10 bg-gray-100"></div>
                            </div>
                          )}
                        </div>
                      </td>
                      {week.map(day => {
                        const dateStr = format(day, 'yyyy-MM-dd');
                        const dayData = (allSchedules[emp.id] || {})[dateStr];
                        return (
                          <td key={dateStr} className="p-2 border-b border-l border-gray-100">
                            {renderDayCell(emp.id, dateStr, dayData)}
                          </td>
                        );
                      })}
                      {/* Fill empty cells if week is partial */}
                      {week.length < 7 && Array.from({ length: 7 - week.length }).map((_, i) => (
                        <td key={`empty-${i}`} className="p-2 border-b border-l border-gray-100 bg-gray-50/20"></td>
                      ))}
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="p-8 space-y-12">
            {filteredEmployees.map(emp => (
              <div key={emp.id} className="space-y-6">
                <div className="flex items-center gap-4 border-b border-gray-100 pb-4">
                  <Avatar
                    name={emp.name}
                    photoUrl={emp.photoUrl}
                    className={`w-12 h-12 rounded-2xl flex items-center justify-center text-white font-black shadow-lg overflow-hidden ${ELEVATED_ROLES.includes(emp.role) ? 'bg-purple-600' : 'bg-blue-600'}`}
                  />
                  <div>
                    <h3 className="text-lg font-black text-gray-900 flex items-center gap-2">
                      {emp.name}
                      {ELEVATED_ROLES.includes(emp.role) && (
                        <span className="bg-purple-100 text-purple-700 text-[8px] px-2 py-0.5 rounded-md font-black uppercase tracking-wider">{roleLabel(emp.role)}</span>
                      )}
                    </h3>
                    <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest">{emp.jobTitle || 'CSR'}</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
                  {displayedDays.map(day => {
                    const dateStr = format(day, 'yyyy-MM-dd');
                    const dayData = (allSchedules[emp.id] || {})[dateStr];
                    return (
                      <div key={dateStr} className="space-y-2">
                        <div className="flex justify-between items-center px-2">
                          <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{format(day, 'EEE')}</span>
                          <span className="text-xs font-black text-gray-900">{format(day, 'MMM d')}</span>
                        </div>
                        {renderDayCell(emp.id, dateStr, dayData)}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-8 space-y-12">
            {filteredEmployees.map(emp => (
              <div key={emp.id} className="space-y-6">
                <div className="flex items-center gap-4 border-b border-gray-100 pb-4">
                  <Avatar
                    name={emp.name}
                    photoUrl={emp.photoUrl}
                    className={`w-12 h-12 rounded-2xl flex items-center justify-center text-white font-black shadow-lg overflow-hidden ${ELEVATED_ROLES.includes(emp.role) ? 'bg-purple-600' : 'bg-blue-600'}`}
                  />
                  <div>
                    <h3 className="text-lg font-black text-gray-900 flex items-center gap-2">
                      {emp.name}
                      {ELEVATED_ROLES.includes(emp.role) && (
                        <span className="bg-purple-100 text-purple-700 text-[8px] px-2 py-0.5 rounded-md font-black uppercase tracking-wider">{roleLabel(emp.role)}</span>
                      )}
                    </h3>
                    <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest">{emp.jobTitle || 'CSR'}</p>
                  </div>
                </div>
                <div className="space-y-3">
                  {displayedDays.map(day => {
                    const dateStr = format(day, 'yyyy-MM-dd');
                    const dayData = (allSchedules[emp.id] || {})[dateStr];
                    return (
                      <div key={dateStr} className="flex items-center gap-4 bg-gray-50/50 p-4 rounded-3xl border border-gray-100">
                        <div className="w-24 shrink-0">
                          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{format(day, 'EEEE')}</p>
                          <p className="text-sm font-black text-gray-900">{format(day, 'MMM d, yyyy')}</p>
                        </div>
                        <div className="flex-1">
                          {renderDayCell(emp.id, dateStr, dayData, true)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showAiModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-md">
          <div className="bg-white rounded-[32px] shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col">
            <div className="px-8 py-6 flex justify-between items-center border-b border-gray-50">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-violet-600 to-fuchsia-600 flex items-center justify-center text-white"><Wand2 size={22} /></div>
                <div>
                  <h2 className="text-xl font-black text-gray-900">AI Schedule</h2>
                  <p className="text-[10px] font-black text-violet-600 uppercase tracking-widest">Week of {format(currentWeekStart, 'MMM d')}</p>
                </div>
              </div>
              <button onClick={() => setShowAiModal(false)} className="p-2 hover:bg-gray-50 rounded-xl text-gray-400"><X size={24} /></button>
            </div>

            <div className="p-8 space-y-5 overflow-y-auto">
              <div>
                <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest ml-1">Describe the week (type or speak)</label>
                <div className="relative mt-2">
                  <textarea
                    value={aiText}
                    onChange={e => setAiText(e.target.value)}
                    rows={3}
                    placeholder='مثال: "أحمد علاء طول الأسبوع من 4 إلى 12 ويوم السبت إجازة"'
                    className="w-full p-4 pr-16 bg-gray-50 border border-gray-100 rounded-2xl text-gray-900 font-medium outline-none focus:ring-4 focus:ring-violet-500/10 focus:bg-white transition-all resize-none"
                  />
                  <button
                    onClick={listening ? stopListening : startListening}
                    title={listening ? 'Stop' : 'Speak'}
                    className={`absolute right-3 top-3 w-10 h-10 rounded-xl flex items-center justify-center transition-all ${listening ? 'bg-rose-500 text-white animate-pulse' : 'bg-violet-600 text-white hover:bg-violet-700'}`}
                  >
                    <Mic size={18} />
                  </button>
                </div>
                <p className="text-[10px] text-gray-400 font-bold mt-1.5 ml-1">اذكر اسم الموظف + أوقات الورديات + أيام الإجازة.</p>
              </div>

              {aiError && <div className="p-3 bg-rose-50 text-rose-600 rounded-xl text-xs font-black uppercase tracking-wide border border-rose-100">{aiError}</div>}

              <button onClick={analyzeAi} disabled={aiBusy || !aiText.trim()} className="w-full flex items-center justify-center gap-2 py-3.5 bg-gray-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-black transition-all disabled:opacity-50 active:scale-95">
                <Sparkles size={16} /> {aiBusy ? 'Analyzing…' : 'Analyze'}
              </button>

              {aiResult && (
                <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-black text-gray-400 uppercase tracking-widest">Preview for</span>
                    <span className="font-black text-gray-900">{aiResult.employeeName}</span>
                  </div>
                  {aiResult.note && <p className="text-[11px] text-amber-600 font-bold bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">{aiResult.note}</p>}
                  <div className="border border-gray-100 rounded-2xl overflow-hidden divide-y divide-gray-50">
                    {aiResult.days.map((d, i) => {
                      const isShift = d.startTime && d.endTime;
                      return (
                        <div key={i} className="flex items-center justify-between px-4 py-2.5">
                          <span className="text-xs font-black text-gray-700">{format(new Date(d.date.replace(/-/g, '/')), 'EEE, MMM d')}</span>
                          {isShift ? (
                            <span className="text-xs font-black text-blue-600">{d.startTime} - {d.endTime}</span>
                          ) : (
                            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{dayTypeLabel(String(d.type || 'DAY_OFF'))}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <button onClick={saveAi} disabled={isSaving} className="w-full flex items-center justify-center gap-2 py-4 bg-violet-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-violet-700 transition-all disabled:opacity-50 active:scale-95">
                    <Save size={16} /> {isSaving ? 'Saving…' : `Save week for ${aiResult.employeeName}`}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {editingDay && editFormData && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-md">
          <div className="bg-white rounded-[48px] shadow-2xl w-full max-w-4xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-8 border-b border-gray-50 flex justify-between items-center bg-white">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-blue-600 flex items-center justify-center text-white shadow-lg"><Calendar size={24} /></div>
                <div><h2 className="text-xl font-black text-gray-900">Modify Roster</h2><p className="text-[10px] font-black text-blue-600 uppercase tracking-[0.2em]">{format(new Date(editingDay.date.replace(/-/g, '/')), 'EEEE, MMMM do').toUpperCase()}</p></div>
              </div>
              <button onClick={() => setEditingDay(null)} className="p-3 hover:bg-gray-50 rounded-2xl text-gray-400 transition-colors"><X size={24} /></button>
            </div>
            
            <div className="p-10 space-y-10 overflow-y-auto max-h-[80vh] hide-scrollbar">
              <div className="space-y-4">
                <label className="text-[11px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Classification</label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[DayType.NORMAL_SHIFT, DayType.WORK_FROM_HOME, DayType.TASK, DayType.DAY_OFF, DayType.ABSENT, DayType.PUBLIC_HOLIDAY, DayType.ANNUAL_LEAVE, DayType.SICK, DayType.TRAINING, DayType.TARDY, DayType.EARLY_LEAVE, DayType.DELAY_WAS_PERMISSION, DayType.OFF_SET, DayType.CANCEL_OFF].map(type => (
                    <button key={type} onClick={() => handleTypeChange(type)} className={`py-3.5 px-4 rounded-2xl text-[10px] font-black uppercase border-2 transition-all ${editFormData.type === type ? 'border-blue-600 bg-blue-600 text-white shadow-xl shadow-blue-100' : 'border-transparent bg-[#F8FAFC] text-gray-500 hover:bg-gray-100'}`}>
                      {dayTypeLabel(type)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Shift templates */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Templates</label>
                  {editFormData.shift && (
                    <button onClick={saveAsTemplate} className="flex items-center gap-1.5 text-[10px] font-black text-blue-600 uppercase tracking-widest hover:text-blue-800 transition-colors">
                      <Plus size={14} /> Save current as template
                    </button>
                  )}
                </div>
                {templates.length === 0 ? (
                  <p className="text-[11px] text-gray-300 font-bold ml-1">No saved templates yet. Configure a shift below, then "Save current as template".</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {templates.map(tpl => (
                      <div key={tpl.id} className="group flex items-center gap-1 bg-blue-50 border border-blue-100 rounded-xl pl-3 pr-1 py-1">
                        <button onClick={() => applyTemplate(tpl)} className="text-[10px] font-black text-blue-700 uppercase tracking-wide hover:text-blue-900" title="Apply this template">
                          {tpl.name}{tpl.shift ? ` · ${tpl.shift.startTime}-${tpl.shift.endTime}` : ''}
                        </button>
                        <button
                          onClick={async () => { if (confirm(`Delete template "${tpl.name}"?`)) await store.deleteTemplate(tpl.id); }}
                          className="p-1 text-blue-300 hover:text-rose-500 transition-colors"
                          title="Delete template"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {[DayType.TASK, DayType.TARDY, DayType.EARLY_LEAVE, DayType.DELAY_WAS_PERMISSION].includes(editFormData.type) && (
                <div className="space-y-4 p-6 bg-gray-50 rounded-[32px] border border-gray-100 animate-in slide-in-from-top-4 duration-300">
                  <div className="flex items-center gap-3 mb-2">
                    <Timer size={20} className="text-blue-600" />
                    <label className="text-[11px] font-black text-gray-900 uppercase tracking-[0.2em]">Duration (Minutes)</label>
                  </div>
                  <div className="relative">
                    <input 
                      type="number" 
                      value={editFormData.minutes || ''} 
                      onChange={e => setEditFormData({ ...editFormData, minutes: parseInt(e.target.value) || 0 })}
                      placeholder="e.g. 15, 30, 60"
                      className="w-full p-5 bg-white border border-gray-200 rounded-2xl font-black text-lg outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all text-gray-900 placeholder:text-gray-300"
                    />
                    <div className="absolute right-5 top-1/2 -translate-y-1/2 text-gray-400 font-black text-xs uppercase tracking-widest pointer-events-none">MINS</div>
                  </div>
                </div>
              )}

              {[DayType.NORMAL_SHIFT, DayType.WORK_FROM_HOME, DayType.TASK, DayType.TARDY, DayType.EARLY_LEAVE, DayType.DELAY_WAS_PERMISSION, DayType.CANCEL_OFF].includes(editFormData.type) && editFormData.shift && (
                <div className="space-y-10 animate-in slide-in-from-bottom-4 duration-300">
                  <div className="grid grid-cols-2 gap-8">
                    <div className="space-y-3">
                      <label className="text-[11px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Shift Start</label>
                      <input type="time" value={editFormData.shift.startTime} onChange={e => handleTimeChange('start', e.target.value)} className="w-full p-5 bg-[#F8FAFC] border border-transparent rounded-2xl font-black text-lg outline-none focus:bg-white focus:border-blue-500 transition-all text-gray-900" />
                    </div>
                    <div className="space-y-3">
                      <label className="text-[11px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Shift End</label>
                      <input type="time" value={editFormData.shift.endTime} onChange={e => handleTimeChange('end', e.target.value)} className="w-full p-5 bg-[#F8FAFC] border border-transparent rounded-2xl font-black text-lg outline-none focus:bg-white focus:border-blue-500 transition-all text-gray-900" />
                    </div>
                  </div>

                  {isBranchEmployeeTarget(editingDay.userId) && (
                    <div className="space-y-4 p-6 bg-violet-50 rounded-[32px] border border-violet-100">
                      <div className="flex items-center gap-3 mb-2">
                        <Timer size={20} className="text-violet-600" />
                        <label className="text-[11px] font-black text-gray-900 uppercase tracking-[0.2em]">Overtime</label>
                      </div>
                      <div className="relative">
                        <input
                          type="number"
                          min={0}
                          step={0.5}
                          value={editFormData.overtimeHours || ''}
                          onChange={e => setEditFormData({ ...editFormData, overtimeHours: parseFloat(e.target.value) || 0 })}
                          placeholder="e.g. 2, 4"
                          className="w-full p-5 bg-white border border-gray-200 rounded-2xl font-black text-lg outline-none focus:ring-4 focus:ring-violet-500/10 focus:border-violet-500 transition-all text-gray-900 placeholder:text-gray-300"
                        />
                        <div className="absolute right-5 top-1/2 -translate-y-1/2 text-gray-400 font-black text-xs uppercase tracking-widest pointer-events-none">HOURS</div>
                      </div>
                    </div>
                  )}

                  <div className="space-y-6 p-8 bg-emerald-50/50 border border-emerald-100 rounded-[32px]">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-emerald-600 text-white rounded-xl shadow-lg shadow-emerald-100">
                          <Copy size={18} />
                        </div>
                        <div>
                          <label className="text-[11px] font-black text-emerald-900 uppercase tracking-[0.2em]">Apply to other days</label>
                          <p className="text-[9px] font-bold text-emerald-600/60 uppercase tracking-widest mt-0.5">Duplicates this shift across the week</p>
                        </div>
                      </div>
                      <button 
                        onClick={() => setApplyToWeek(!applyToWeek)}
                        className={`px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${applyToWeek ? 'bg-emerald-600 text-white shadow-xl shadow-emerald-100' : 'bg-white border border-emerald-100 text-emerald-600 hover:bg-emerald-50'}`}
                      >
                        {applyToWeek ? 'Bulk Mode Active' : 'Enable Bulk Mode'}
                      </button>
                    </div>

                    {applyToWeek && (
                      <div className="space-y-6 pt-6 border-t border-emerald-100 animate-in slide-in-from-top-2 duration-300">
                        <div className="flex flex-wrap gap-2">
                          {dayLabels.map((label, idx) => (
                            <button
                              key={label}
                              onClick={() => toggleWeekDay(idx)}
                              className={`w-12 h-12 rounded-2xl text-[10px] font-black transition-all flex items-center justify-center border-2 ${selectedWeekDays.includes(idx) ? 'bg-emerald-600 border-emerald-600 text-white shadow-lg' : 'bg-white border-emerald-50 text-emerald-300 hover:border-emerald-200'}`}
                            >
                              {label[0]}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-6">
                    <label className="text-[11px] font-black text-[#64748B] uppercase tracking-[0.2em] ml-1">Breaks (Staggered Automatically)</label>
                    <div className="space-y-5">
                      {editFormData.shift.breaks.map((br, idx) => (
                        <div key={idx} className="grid grid-cols-[140px_1fr_1fr] items-center gap-6 group">
                          <span className="text-sm font-semibold text-[#475569]">{breakLabels[idx]}</span>
                          <div className="relative">
                            <input type="time" value={br.start} onChange={(e) => handleBreakChange(idx, 'start', e.target.value)} className="w-full bg-white border border-[#E2E8F0] rounded-[14px] px-5 py-3.5 text-base font-bold text-[#1E293B] outline-none focus:border-blue-500 transition-all pr-12 appearance-none" />
                            <Clock className="absolute right-4 top-1/2 -translate-y-1/2 text-[#94A3B8] pointer-events-none" size={18} />
                          </div>
                          <div className="relative">
                            <input type="time" value={br.end} onChange={(e) => handleBreakChange(idx, 'end', e.target.value)} className="w-full bg-white border border-[#E2E8F0] rounded-[14px] px-5 py-3.5 text-base font-bold text-[#1E293B] outline-none focus:border-blue-500 transition-all pr-12 appearance-none" />
                            <Clock className="absolute right-4 top-1/2 -translate-y-1/2 text-[#94A3B8] pointer-events-none" size={18} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-6 pt-6 border-t border-gray-100">
                <button onClick={saveDay} disabled={isSaving} className="w-full py-6 bg-gray-900 text-white rounded-[32px] font-black text-sm uppercase tracking-[0.2em] shadow-2xl hover:bg-black transition-all active:scale-[0.98] flex items-center justify-center gap-3 disabled:opacity-50">
                  <Save size={20} /> {isSaving ? 'Processing...' : 'Save Roster Entry'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showRangeExportModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-md">
          <div className="bg-white rounded-[40px] shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in duration-200">
            <div className="px-8 py-6 bg-blue-600 text-white flex justify-between items-center">
              <h3 className="font-black text-xl tracking-tight">Export Date Range</h3>
              <button onClick={() => setShowRangeExportModal(false)} className="p-2 hover:bg-blue-700 rounded-full"><X size={24} /></button>
            </div>
            <div className="p-10 space-y-8">
              <div className="grid grid-cols-1 gap-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Start Date</label>
                  <div className="relative">
                    <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <input 
                      type="date"
                      value={exportStartDate}
                      onChange={e => setExportStartDate(e.target.value)}
                      className="w-full pl-12 pr-4 py-4 rounded-2xl border border-gray-200 text-sm font-bold bg-gray-50 outline-none focus:ring-4 focus:ring-blue-500/10 transition-all"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">End Date</label>
                  <div className="relative">
                    <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <input 
                      type="date"
                      value={exportEndDate}
                      onChange={e => setExportEndDate(e.target.value)}
                      className="w-full pl-12 pr-4 py-4 rounded-2xl border border-gray-200 text-sm font-bold bg-gray-50 outline-none focus:ring-4 focus:ring-blue-500/10 transition-all"
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-col space-y-3">
                <button 
                  onClick={exportRangeToExcel}
                  className="w-full bg-blue-600 text-white py-5 rounded-[24px] font-black text-sm uppercase tracking-widest shadow-xl shadow-blue-200 hover:bg-blue-700 transition-all active:scale-95 flex items-center justify-center space-x-2"
                >
                  <FileSpreadsheet size={18} />
                  <span>Download Excel</span>
                </button>
                <button onClick={() => setShowRangeExportModal(false)} className="w-full py-2 text-xs font-black text-gray-400 hover:text-gray-600 uppercase tracking-widest">Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showBulkUploadModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-md">
          <div className="bg-white rounded-[40px] shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in duration-200">
            <div className="px-8 py-6 bg-indigo-600 text-white flex justify-between items-center">
              <div className="flex items-center gap-3">
                <Upload size={24} />
                <h3 className="font-black text-xl tracking-tight uppercase">Bulk Upload Shifts</h3>
              </div>
              <button onClick={() => { setShowBulkUploadModal(false); setBulkUploadProgress(null); }} className="p-2 hover:bg-indigo-700 rounded-full"><X size={24} /></button>
            </div>
            <div className="p-10 space-y-8">
              <div className="bg-indigo-50 border border-indigo-100 rounded-3xl p-6 space-y-4">
                <h4 className="text-xs font-black text-indigo-900 uppercase tracking-widest">Excel Format Instructions</h4>
                <p className="text-[10px] font-bold text-indigo-600/80 leading-relaxed uppercase tracking-wider">
                  The system will apply shifts to the 7 days of the currently selected week ({format(weekDays[0], 'MMM d')} - {format(weekDays[6], 'MMM d')}).
                </p>
                <div className="grid grid-cols-1 gap-2">
                  <div className="flex items-center gap-2 text-[9px] font-black text-indigo-900 uppercase bg-white/50 px-3 py-1.5 rounded-lg border border-indigo-100/50">
                    <Check size={10} className="text-emerald-500" />
                    Column A: EM ID (Employee ID)
                  </div>
                  <div className="flex items-center gap-2 text-[9px] font-black text-indigo-900 uppercase bg-white/50 px-3 py-1.5 rounded-lg border border-indigo-100/50">
                    <Check size={10} className="text-emerald-500" />
                    Column B: Name (Optional)
                  </div>
                  <div className="flex items-center gap-2 text-[9px] font-black text-indigo-900 uppercase bg-white/50 px-3 py-1.5 rounded-lg border border-indigo-100/50">
                    <Check size={10} className="text-emerald-500" />
                    Columns C-I: Sunday to Saturday Shifts
                  </div>
                </div>
                <div className="bg-white/40 p-3 rounded-xl border border-indigo-100/30">
                  <p className="text-[9px] font-bold text-indigo-600 uppercase tracking-widest mb-1">Cell Value Examples:</p>
                  <div className="flex flex-wrap gap-2">
                    <code className="text-[9px] font-black text-indigo-900 bg-white px-2 py-1 rounded">08:00 - 16:00</code>
                    <code className="text-[9px] font-black text-indigo-900 bg-white px-2 py-1 rounded">OFF</code>
                    <code className="text-[9px] font-black text-indigo-900 bg-white px-2 py-1 rounded">ABSENT</code>
                    <code className="text-[9px] font-black text-indigo-900 bg-white px-2 py-1 rounded">PUBLIC</code>
                    <code className="text-[9px] font-black text-indigo-900 bg-white px-2 py-1 rounded">SICK</code>
                    <code className="text-[9px] font-black text-indigo-900 bg-white px-2 py-1 rounded">ANNUAL</code>
                    <code className="text-[9px] font-black text-indigo-900 bg-white px-2 py-1 rounded">08:00 - 16:00 C.OFF</code>
                  </div>
                </div>
              </div>

              <button
                onClick={downloadBulkTemplate}
                className="w-full flex items-center justify-center gap-2 py-4 bg-white border-2 border-indigo-100 text-indigo-700 rounded-2xl font-black text-[11px] uppercase tracking-widest hover:bg-indigo-50 hover:border-indigo-300 transition-all active:scale-95"
              >
                <Download size={16} />
                Download Template ({filteredEmployees.length} employee{filteredEmployees.length === 1 ? '' : 's'} · {format(weekDays[0], 'MMM d')} - {format(weekDays[6], 'MMM d')})
              </button>

              {!bulkUploadProgress ? (
                <div className="relative">
                  <input 
                    type="file" 
                    accept=".xlsx, .xls" 
                    onChange={handleBulkUpload}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  />
                  <div className="border-2 border-dashed border-gray-200 rounded-[32px] p-12 flex flex-col items-center justify-center gap-4 hover:border-indigo-400 hover:bg-indigo-50/30 transition-all group">
                    <div className="w-16 h-16 rounded-2xl bg-gray-50 flex items-center justify-center text-gray-400 group-hover:bg-white group-hover:text-indigo-600 shadow-sm transition-all">
                      <FileSpreadsheet size={32} />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-black text-gray-900 uppercase tracking-widest">Click to upload Excel</p>
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">or drag and drop file here</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <div className="flex justify-between items-center text-[10px] font-black text-gray-400 uppercase tracking-widest">
                      <span>Processing Progress</span>
                      <span>{Math.round((bulkUploadProgress.current / bulkUploadProgress.total) * 100)}%</span>
                    </div>
                    <div className="h-3 bg-gray-100 rounded-full overflow-hidden border border-gray-50">
                      <div 
                        className="h-full bg-indigo-600 transition-all duration-300" 
                        style={{ width: `${(bulkUploadProgress.current / bulkUploadProgress.total) * 100}%` }}
                      />
                    </div>
                    <p className="text-center text-[10px] font-black text-gray-900 uppercase tracking-widest">
                      {bulkUploadProgress.current} / {bulkUploadProgress.total} Rows Processed
                    </p>
                  </div>

                  {bulkUploadProgress.errors.length > 0 && (
                    <div className="bg-rose-50 border border-rose-100 rounded-2xl p-6 space-y-3 max-h-[200px] overflow-y-auto hide-scrollbar">
                      <div className="flex items-center gap-2 text-rose-600 mb-2">
                        <XCircle size={16} />
                        <h5 className="text-[10px] font-black uppercase tracking-widest">Upload Errors ({bulkUploadProgress.errors.length})</h5>
                      </div>
                      {bulkUploadProgress.errors.map((err, idx) => (
                        <p key={idx} className="text-[9px] font-bold text-rose-500 uppercase tracking-wider border-l-2 border-rose-200 pl-3 py-0.5">
                          {err}
                        </p>
                      ))}
                    </div>
                  )}

                  {bulkUploadProgress.current === bulkUploadProgress.total && bulkUploadProgress.errors.length > 0 && (
                    <button 
                      onClick={() => { setShowBulkUploadModal(false); setBulkUploadProgress(null); }}
                      className="w-full py-4 bg-gray-900 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-black transition-all"
                    >
                      Close & Review Errors
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showClearWeekModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-md">
          <div className="bg-white rounded-[40px] shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in duration-200">
            <div className="p-10 text-center space-y-6">
              <div className="w-20 h-20 bg-rose-50 text-rose-500 rounded-3xl flex items-center justify-center mx-auto shadow-inner">
                <Trash2 size={40} />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-black text-gray-900 uppercase tracking-tight">Clear This Week?</h3>
                <p className="text-sm font-bold text-gray-500 leading-relaxed">
                  This will permanently delete all shifts and roster data for the currently selected week:
                  <span className="block text-rose-600 mt-2 font-black">
                    {format(weekDays[0], 'MMM d')} - {format(weekDays[6], 'MMM d, yyyy')}
                  </span>
                </p>
              </div>
              <div className="flex flex-col gap-3 pt-4">
                <button 
                  onClick={handleClearWeek}
                  disabled={isSaving}
                  className="w-full py-4 bg-rose-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-rose-700 transition-all shadow-xl shadow-rose-100 disabled:opacity-50"
                >
                  {isSaving ? 'Clearing...' : 'Yes, Clear Everything'}
                </button>
                <button 
                  onClick={() => setShowClearWeekModal(false)}
                  className="w-full py-4 bg-gray-50 text-gray-400 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-gray-100 transition-all"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showAllCompanySummary && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-md">
          <div className="bg-white rounded-[48px] shadow-2xl w-full max-w-6xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
            <div className="p-8 border-b border-gray-50 flex justify-between items-center bg-white shrink-0">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-200"><ClipboardList size={24} /></div>
                <div>
                  <h2 className="text-xl font-black text-gray-900">All Company Summary</h2>
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Aggregate Attendance & Leave Records</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 bg-gray-50 p-2 rounded-2xl border border-gray-100">
                  <div className="flex items-center gap-1">
                    <input 
                      type="date" 
                      value={summaryStartDate}
                      onChange={(e) => setSummaryStartDate(e.target.value)}
                      className="bg-transparent border-none text-[10px] font-black uppercase outline-none w-[110px] cursor-pointer"
                    />
                    <span className="text-gray-300">→</span>
                    <input 
                      type="date" 
                      value={summaryEndDate}
                      onChange={(e) => setSummaryEndDate(e.target.value)}
                      className="bg-transparent border-none text-[10px] font-black uppercase outline-none w-[110px] cursor-pointer"
                    />
                  </div>
                </div>
                <button onClick={() => setShowAllCompanySummary(false)} className="p-3 hover:bg-gray-50 rounded-2xl text-gray-400 transition-colors"><X size={24} /></button>
              </div>
            </div>
            
            <div className="p-0 overflow-auto flex-1 hide-scrollbar">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-white z-10 shadow-sm">
                  <tr className="border-b border-gray-100">
                    <th className="px-8 py-6 text-[10px] font-black text-gray-400 uppercase tracking-widest bg-gray-50/50">Employee</th>
                    <th className="px-4 py-6 text-[10px] font-black text-emerald-600 uppercase tracking-widest text-center bg-emerald-50/30">Annual Bal</th>
                    <th className="px-4 py-6 text-[10px] font-black text-orange-600 uppercase tracking-widest text-center bg-orange-50/30">Public Bal</th>
                    <th className="px-4 py-6 text-[10px] font-black text-emerald-600 uppercase tracking-widest text-center bg-emerald-50/30">Annual</th>
                    <th className="px-4 py-6 text-[10px] font-black text-rose-600 uppercase tracking-widest text-center bg-rose-50/30">Sick</th>
                    <th className="px-4 py-6 text-[10px] font-black text-orange-600 uppercase tracking-widest text-center bg-orange-50/30">Public</th>
                    <th className="px-4 py-6 text-[10px] font-black text-rose-700 uppercase tracking-widest text-center bg-rose-100/30">Absent</th>
                    <th className="px-4 py-6 text-[10px] font-black text-indigo-600 uppercase tracking-widest text-center bg-indigo-50/30">Late</th>
                    <th className="px-4 py-6 text-[10px] font-black text-rose-500 uppercase tracking-widest text-center bg-rose-50/30">Leave Perm.</th>
                    <th className="px-4 py-6 text-[10px] font-black text-teal-600 uppercase tracking-widest text-center bg-teal-50/30">Late Perm.</th>
                    <th className="px-4 py-6 text-[10px] font-black text-indigo-600 uppercase tracking-widest text-center bg-indigo-50/30">Training</th>
                    <th className="px-4 py-6 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center bg-gray-50/30">Off</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredEmployees.map(emp => {
                    const summary = getEmployeeSummary(emp.id);
                    return (
                      <tr key={emp.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-8 py-5">
                          <div className="flex items-center gap-3">
                            <Avatar
                              name={emp.name}
                              photoUrl={emp.photoUrl}
                              className="w-8 h-8 rounded-lg bg-gray-900 flex items-center justify-center text-white font-black text-xs overflow-hidden"
                            />
                            <div>
                              <p className="text-sm font-black text-gray-900">{emp.name}</p>
                              <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider">{emp.jobTitle || 'CSR'}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-5 text-center">
                          <span className={`text-xs font-black ${ (emp.annualBalance || 0) < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                            {emp.annualBalance || 0}
                          </span>
                        </td>
                        <td className="px-4 py-5 text-center">
                          <span className={`text-xs font-black ${ (emp.publicBalance || 0) < 0 ? 'text-rose-600' : 'text-orange-600'}`}>
                            {emp.publicBalance || 0}
                          </span>
                        </td>
                        <td className="px-4 py-5 text-center">
                          <div className="flex flex-col items-center gap-2">
                            <span className={`px-3 py-1 rounded-full text-[10px] font-black ${summary[DayType.ANNUAL_LEAVE].length > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-50 text-gray-300'}`}>
                              {summary[DayType.ANNUAL_LEAVE].length}
                            </span>
                            {summary[DayType.ANNUAL_LEAVE].length > 0 && (
                              <div className="grid grid-cols-7 gap-0.5 max-w-[140px] mx-auto">
                                {summary[DayType.ANNUAL_LEAVE].sort().map(date => (
                                  <span key={date} className="text-[7px] font-bold text-emerald-600 bg-emerald-50 px-0.5 py-0.5 rounded border border-emerald-100/50 text-center min-w-[16px]">
                                    {format(new Date(date.replace(/-/g, '/')), 'dd')}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-5 text-center">
                          <div className="flex flex-col items-center gap-2">
                            <span className={`px-3 py-1 rounded-full text-[10px] font-black ${summary[DayType.SICK].length > 0 ? 'bg-rose-100 text-rose-700' : 'bg-gray-50 text-gray-300'}`}>
                              {summary[DayType.SICK].length}
                            </span>
                            {summary[DayType.SICK].length > 0 && (
                              <div className="grid grid-cols-7 gap-0.5 max-w-[140px] mx-auto">
                                {summary[DayType.SICK].sort().map(date => (
                                  <span key={date} className="text-[7px] font-bold text-rose-600 bg-rose-50 px-0.5 py-0.5 rounded border border-rose-100/50 text-center min-w-[16px]">
                                    {format(new Date(date.replace(/-/g, '/')), 'dd')}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-5 text-center">
                          <div className="flex flex-col items-center gap-2">
                            <span className={`px-3 py-1 rounded-full text-[10px] font-black ${summary[DayType.PUBLIC_HOLIDAY].length > 0 ? 'bg-orange-100 text-orange-700' : 'bg-gray-50 text-gray-300'}`}>
                              {summary[DayType.PUBLIC_HOLIDAY].length}
                            </span>
                            {summary[DayType.PUBLIC_HOLIDAY].length > 0 && (
                              <div className="grid grid-cols-7 gap-0.5 max-w-[140px] mx-auto">
                                {summary[DayType.PUBLIC_HOLIDAY].sort().map(date => (
                                  <span key={date} className="text-[7px] font-bold text-orange-600 bg-orange-50 px-0.5 py-0.5 rounded border border-orange-100/50 text-center min-w-[16px]">
                                    {format(new Date(date.replace(/-/g, '/')), 'dd')}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-5 text-center">
                          <div className="flex flex-col items-center gap-2">
                            <span className={`px-3 py-1 rounded-full text-[10px] font-black ${summary[DayType.ABSENT].length > 0 ? 'bg-rose-200 text-rose-800' : 'bg-gray-50 text-gray-300'}`}>
                              {summary[DayType.ABSENT].length}
                            </span>
                            {summary[DayType.ABSENT].length > 0 && (
                              <div className="grid grid-cols-7 gap-0.5 max-w-[140px] mx-auto">
                                {summary[DayType.ABSENT].sort().map(date => (
                                  <span key={date} className="text-[7px] font-bold text-rose-800 bg-rose-100 px-0.5 py-0.5 rounded border border-rose-200/50 text-center min-w-[16px]">
                                    {format(new Date(date.replace(/-/g, '/')), 'dd')}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-5 text-center">
                          <div className="flex flex-col items-center gap-2">
                            <span className={`px-3 py-1 rounded-full text-[10px] font-black ${summary[DayType.TARDY].length > 0 ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-50 text-gray-300'}`}>
                              {summary[DayType.TARDY].length}
                            </span>
                            {summary[DayType.TARDY].length > 0 && (
                              <div className="grid grid-cols-7 gap-0.5 max-w-[140px] mx-auto">
                                {summary[DayType.TARDY].sort().map(date => (
                                  <span key={date} className="text-[7px] font-bold text-indigo-600 bg-indigo-50 px-0.5 py-0.5 rounded border border-indigo-100/50 text-center min-w-[16px]">
                                    {format(new Date(date.replace(/-/g, '/')), 'dd')}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-5 text-center">
                          <div className="flex flex-col items-center gap-2">
                            <span className={`px-3 py-1 rounded-full text-[10px] font-black ${summary[DayType.EARLY_LEAVE].length > 0 ? 'bg-rose-100 text-rose-600' : 'bg-gray-50 text-gray-300'}`}>
                              {summary[DayType.EARLY_LEAVE].length}
                            </span>
                            {summary[DayType.EARLY_LEAVE].length > 0 && (
                              <div className="grid grid-cols-7 gap-0.5 max-w-[140px] mx-auto">
                                {summary[DayType.EARLY_LEAVE].sort().map(date => (
                                  <span key={date} className="text-[7px] font-bold text-rose-600 bg-rose-50 px-0.5 py-0.5 rounded border border-rose-100/50 text-center min-w-[16px]">
                                    {format(new Date(date.replace(/-/g, '/')), 'dd')}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-5 text-center">
                          <div className="flex flex-col items-center gap-2">
                            <span className={`px-3 py-1 rounded-full text-[10px] font-black ${summary[DayType.DELAY_WAS_PERMISSION].length > 0 ? 'bg-teal-100 text-teal-700' : 'bg-gray-50 text-gray-300'}`}>
                              {summary[DayType.DELAY_WAS_PERMISSION].length}
                            </span>
                            {summary[DayType.DELAY_WAS_PERMISSION].length > 0 && (
                              <div className="grid grid-cols-7 gap-0.5 max-w-[140px] mx-auto">
                                {summary[DayType.DELAY_WAS_PERMISSION].sort().map(date => (
                                  <span key={date} className="text-[7px] font-bold text-teal-600 bg-teal-50 px-0.5 py-0.5 rounded border border-teal-100/50 text-center min-w-[16px]">
                                    {format(new Date(date.replace(/-/g, '/')), 'dd')}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-5 text-center">
                          <div className="flex flex-col items-center gap-2">
                            <span className={`px-3 py-1 rounded-full text-[10px] font-black ${summary[DayType.TRAINING].length > 0 ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-50 text-gray-300'}`}>
                              {summary[DayType.TRAINING].length}
                            </span>
                            {summary[DayType.TRAINING].length > 0 && (
                              <div className="grid grid-cols-7 gap-0.5 max-w-[140px] mx-auto">
                                {summary[DayType.TRAINING].sort().map(date => (
                                  <span key={date} className="text-[7px] font-bold text-indigo-600 bg-indigo-50 px-0.5 py-0.5 rounded border border-indigo-100/50 text-center min-w-[16px]">
                                    {format(new Date(date.replace(/-/g, '/')), 'dd')}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-5 text-center">
                          <div className="flex flex-col items-center gap-2">
                            <span className={`px-3 py-1 rounded-full text-[10px] font-black ${summary[DayType.DAY_OFF].length > 0 ? 'bg-gray-100 text-gray-600' : 'bg-gray-50 text-gray-300'}`}>
                              {summary[DayType.DAY_OFF].length}
                            </span>
                            {summary[DayType.DAY_OFF].length > 0 && (
                              <div className="grid grid-cols-7 gap-0.5 max-w-[140px] mx-auto">
                                {summary[DayType.DAY_OFF].sort().map(date => (
                                  <span key={date} className="text-[7px] font-bold text-gray-400 bg-gray-50 px-0.5 py-0.5 rounded border border-gray-100 text-center min-w-[16px]">
                                    {format(new Date(date.replace(/-/g, '/')), 'dd')}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            
            <div className="p-8 bg-gray-50 border-t border-gray-100 flex justify-between items-center shrink-0">
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Showing summary for {filteredEmployees.length} employees</p>
              <button 
                onClick={() => {
                  const dataToExport = filteredEmployees.map(emp => {
                    const summary = getEmployeeSummary(emp.id);
                    return {
                      'Employee Name': emp.name,
                      'Employee ID': emp.employeeId || 'N/A',
                      'Job Title': emp.jobTitle || 'CSR',
                      'Annual Leave Count': summary[DayType.ANNUAL_LEAVE].length,
                      'Annual Leave Dates': summary[DayType.ANNUAL_LEAVE].sort().join(', '),
                      'Sick Leave Count': summary[DayType.SICK].length,
                      'Sick Leave Dates': summary[DayType.SICK].sort().join(', '),
                      'Public Holiday Count': summary[DayType.PUBLIC_HOLIDAY].length,
                      'Public Holiday Dates': summary[DayType.PUBLIC_HOLIDAY].sort().join(', '),
                      'Absent Count': summary[DayType.ABSENT].length,
                      'Absent Dates': summary[DayType.ABSENT].sort().join(', '),
                      'Late Count': summary[DayType.TARDY].length,
                      'Late Dates': summary[DayType.TARDY].sort().join(', '),
                      'Leave with Permission Count': summary[DayType.EARLY_LEAVE].length,
                      'Leave with Permission Dates': summary[DayType.EARLY_LEAVE].sort().join(', '),
                      'Late with Permission Count': summary[DayType.DELAY_WAS_PERMISSION].length,
                      'Late with Permission Dates': summary[DayType.DELAY_WAS_PERMISSION].sort().join(', '),
                      'Day Off Count': summary[DayType.DAY_OFF].length,
                      'Day Off Dates': summary[DayType.DAY_OFF].sort().join(', '),
                      'Off Set Count': summary[DayType.OFF_SET].length,
                      'Off Set Dates': summary[DayType.OFF_SET].sort().join(', '),
                      'Cancel Off Count': summary[DayType.CANCEL_OFF].length,
                      'Cancel Off Dates': summary[DayType.CANCEL_OFF].sort().join(', ')
                    };
                  });
                  const worksheet = XLSX.utils.json_to_sheet(dataToExport);
                  const workbook = XLSX.utils.book_new();
                  XLSX.utils.book_append_sheet(workbook, worksheet, 'Company Summary');
                  XLSX.writeFile(workbook, `Company_Summary_${summaryStartDate || 'All'}_to_${summaryEndDate || 'All'}.xlsx`);
                }}
                className="flex items-center gap-2 px-6 py-3 bg-emerald-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-emerald-100 hover:bg-emerald-700 transition-all active:scale-95"
              >
                <FileSpreadsheet size={16} />
                Export Summary
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedEmployeeSummary && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-md">
          <div className="bg-white rounded-[48px] shadow-2xl w-full max-w-3xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-8 border-b border-gray-50 flex justify-between items-center bg-white">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-gray-900 flex items-center justify-center text-white shadow-lg"><ClipboardList size={24} /></div>
                <div>
                  <h2 className="text-xl font-black text-gray-900">{selectedEmployeeSummary.name}</h2>
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Attendance & Leave Summary</p>
                </div>
              </div>
              <button onClick={() => setSelectedEmployeeSummary(null)} className="p-3 hover:bg-gray-50 rounded-2xl text-gray-400 transition-colors"><X size={24} /></button>
            </div>
            
            <div className="p-10 space-y-8 overflow-y-auto max-h-[70vh] hide-scrollbar">
              {/* Balance Summary Cards */}
              <div className="grid grid-cols-2 gap-6">
                <div className="bg-emerald-50 border-2 border-emerald-100 rounded-[32px] p-6 flex items-center gap-5">
                  <div className="w-14 h-14 rounded-2xl bg-emerald-600 flex items-center justify-center text-white shadow-lg">
                    <Palmtree size={28} />
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Remaining Annual</p>
                    <p className="text-2xl font-black text-gray-900">{(selectedEmployeeSummary.annualBalance || 0) - employeeTotalTaken.annual} Days</p>
                  </div>
                </div>
                <div className="bg-orange-50 border-2 border-orange-100 rounded-[32px] p-6 flex items-center gap-5">
                  <div className="w-14 h-14 rounded-2xl bg-orange-600 flex items-center justify-center text-white shadow-lg">
                    <Star size={28} />
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-orange-600 uppercase tracking-widest">Remaining Public</p>
                    <p className="text-2xl font-black text-gray-900">{(selectedEmployeeSummary.publicBalance || 0) - employeeTotalTaken.public} Days</p>
                  </div>
                </div>
              </div>

              <div className="bg-gray-50/50 border-2 border-gray-100 rounded-[32px] p-8 space-y-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gray-900 flex items-center justify-center text-white shadow-lg">
                      <Filter size={20} />
                    </div>
                    <div>
                      <h3 className="text-sm font-black text-gray-900 uppercase tracking-widest">Filter Records</h3>
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Show records within a specific date range</p>
                    </div>
                  </div>
                  {(summaryStartDate || summaryEndDate) && (
                    <button 
                      onClick={() => { setSummaryStartDate(''); setSummaryEndDate(''); }}
                      className="text-[10px] font-black text-rose-600 uppercase tracking-widest hover:underline"
                    >
                      Clear Filter
                    </button>
                  )}
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest ml-1">From Date</label>
                    <input 
                      type="date" 
                      value={summaryStartDate}
                      onChange={e => setSummaryStartDate(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-gray-100 bg-white text-xs font-bold outline-none focus:ring-4 focus:ring-gray-900/10 transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest ml-1">To Date</label>
                    <input 
                      type="date" 
                      value={summaryEndDate}
                      onChange={e => setSummaryEndDate(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-gray-100 bg-white text-xs font-bold outline-none focus:ring-4 focus:ring-gray-900/10 transition-all"
                    />
                  </div>
                </div>
              </div>

              {canManageToolbar && (
                <div className="bg-blue-50/50 border-2 border-blue-100 rounded-[32px] p-8 space-y-6">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-lg">
                      <Plus size={20} />
                    </div>
                    <div>
                      <h3 className="text-sm font-black text-gray-900 uppercase tracking-widest">Add Historical Record</h3>
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Update records from before system implementation</p>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest ml-1">Date</label>
                      <input 
                        type="date" 
                        value={historicalDate}
                        onChange={e => setHistoricalDate(e.target.value)}
                        className="w-full px-4 py-3 rounded-xl border border-blue-100 bg-white text-xs font-bold outline-none focus:ring-4 focus:ring-blue-500/10 transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[9px] font-black text-gray-400 uppercase tracking-widest ml-1">Type</label>
                      <select 
                        value={historicalType}
                        onChange={e => setHistoricalType(e.target.value as DayType)}
                        className="w-full px-4 py-3 rounded-xl border border-blue-100 bg-white text-xs font-bold outline-none focus:ring-4 focus:ring-blue-500/10 transition-all appearance-none"
                      >
                        <option value={DayType.ANNUAL_LEAVE}>Annual Leave</option>
                        <option value={DayType.SICK}>Sick Leave</option>
                        <option value={DayType.PUBLIC_HOLIDAY}>Public Holiday</option>
                        <option value={DayType.DAY_OFF}>Day Off</option>
                        <option value={DayType.OFF_SET}>Off Set</option>
                        <option value={DayType.CANCEL_OFF}>Cancel Off</option>
                        <option value={DayType.ABSENT}>Absent</option>
                        <option value={DayType.TARDY}>Late</option>
                        <option value={DayType.EARLY_LEAVE}>Leave with Permission</option>
                        <option value={DayType.DELAY_WAS_PERMISSION}>Late with Permission</option>
                      </select>
                    </div>
                    <div className="flex items-end">
                      <button 
                        onClick={addHistoricalDay}
                        disabled={isSaving}
                        className="w-full bg-blue-600 text-white py-3 rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-blue-200 hover:bg-blue-700 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {isSaving ? <Clock size={14} className="animate-spin" /> : <Save size={14} />}
                        Add Record
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {Object.entries(getEmployeeSummary(selectedEmployeeSummary.id)).map(([type, dates]) => {
                  const isAlwaysShown = [DayType.ANNUAL_LEAVE, DayType.SICK, DayType.PUBLIC_HOLIDAY, DayType.ABSENT, DayType.TARDY, DayType.DELAY_WAS_PERMISSION].includes(type as DayType);
                  if (dates.length === 0 && !isAlwaysShown) return null;
                  
                  const icon = type === DayType.ANNUAL_LEAVE ? <Palmtree size={18} className="text-emerald-600" /> :
                               type === DayType.SICK ? <Thermometer size={18} className="text-rose-600" /> :
                               type === DayType.PUBLIC_HOLIDAY ? <Star size={18} className="text-orange-600" /> :
                               type === DayType.ABSENT ? <XCircle size={18} className="text-rose-600" /> :
                               type === DayType.DAY_OFF ? <Moon size={18} className="text-gray-400" /> :
                               type === DayType.OFF_SET ? <Moon size={18} className="text-slate-500" /> :
                               type === DayType.CANCEL_OFF ? <XCircle size={18} className="text-amber-600" /> :
                               type === DayType.TARDY ? <Timer size={18} className="text-indigo-600" /> :
                               type === DayType.DELAY_WAS_PERMISSION ? <Timer size={18} className="text-teal-600" /> :
                               <Clock size={18} className="text-rose-600" />;

                  const colorClass = type === DayType.ANNUAL_LEAVE ? 'bg-emerald-50 border-emerald-100' :
                                     type === DayType.SICK ? 'bg-rose-50 border-rose-100' :
                                     type === DayType.PUBLIC_HOLIDAY ? 'bg-orange-50 border-orange-100' :
                                     type === DayType.ABSENT ? 'bg-rose-50 border-rose-100' :
                                     type === DayType.DAY_OFF ? 'bg-gray-50 border-gray-100' :
                                     type === DayType.OFF_SET ? 'bg-slate-50 border-slate-200' :
                                     type === DayType.CANCEL_OFF ? 'bg-amber-50 border-amber-100' :
                                     type === DayType.TARDY ? 'bg-indigo-50 border-indigo-100' :
                                     type === DayType.DELAY_WAS_PERMISSION ? 'bg-teal-50 border-teal-100' :
                                     'bg-rose-50 border-rose-100';

                  return (
                    <div key={type} className={`p-6 rounded-[32px] border-2 ${colorClass} space-y-4`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {icon}
                          <h4 className="font-black text-gray-900 text-xs uppercase tracking-widest">{dayTypeLabel(type)}</h4>
                        </div>
                        <span className="bg-white px-3 py-1 rounded-full text-xs font-black shadow-sm">{dates.length} Days</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {dates.length > 0 ? (
                          dates.sort().map(date => (
                            <span key={date} className="px-3 py-1 bg-white/50 rounded-lg text-[10px] font-bold text-gray-600 border border-white">
                              {format(new Date(date.replace(/-/g, '/')), 'MMM d, yyyy')}
                            </span>
                          ))
                        ) : (
                          <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest italic opacity-50">No records found</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Leave Request History */}
              <div className="space-y-6 pt-4">
                <div className="flex items-center gap-3 ml-1">
                  <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center text-gray-500">
                    <History size={20} />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-gray-900 uppercase tracking-widest">Leave Request History</h3>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Recent leave and holiday requests</p>
                  </div>
                </div>
                <div className="bg-white border-2 border-gray-100 rounded-[32px] overflow-hidden shadow-sm">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-gray-50/50 border-b border-gray-100">
                        <th className="px-8 py-5 text-[9px] font-black text-gray-400 uppercase tracking-widest">Date</th>
                        <th className="px-8 py-5 text-[9px] font-black text-gray-400 uppercase tracking-widest">Type</th>
                        <th className="px-8 py-5 text-[9px] font-black text-gray-400 uppercase tracking-widest">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {leaveRequests
                        .filter(r => r.userId === selectedEmployeeSummary.id)
                        .sort((a, b) => b.createdAt - a.createdAt)
                        .slice(0, 10)
                        .map(req => (
                          <tr key={req.id} className="hover:bg-gray-50/30 transition-colors">
                            <td className="px-8 py-5 text-xs font-bold text-gray-900">
                              {format(new Date(req.date.replace(/-/g, '/')), 'MMM d, yyyy')}
                            </td>
                            <td className="px-8 py-5 text-xs font-bold text-gray-500 uppercase tracking-wider">
                              {dayTypeLabel(req.type)}
                            </td>
                            <td className="px-8 py-5">
                              <span className={`px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest shadow-sm ${
                                req.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' :
                                req.status === 'REJECTED' ? 'bg-rose-50 text-rose-600 border border-rose-100' :
                                'bg-blue-50 text-blue-600 border border-blue-100'
                              }`}>
                                {req.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      {leaveRequests.filter(r => r.userId === selectedEmployeeSummary.id).length === 0 && (
                        <tr>
                          <td colSpan={3} className="px-8 py-12 text-center text-gray-300 font-bold text-[10px] uppercase tracking-widest">
                            No leave requests found for this employee
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Leave Balance Modal */}
      {showLeaveBalanceModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-[32px] w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl animate-in zoom-in-95 duration-300">
            <div className="p-8 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <div>
                <h2 className="text-2xl font-black text-gray-900 tracking-tight">Leave Balance Management</h2>
                <p className="text-gray-400 text-sm font-medium">Track and manage employee leave quotas.</p>
              </div>
              <button 
                onClick={() => setShowLeaveBalanceModal(false)}
                className="p-3 hover:bg-white rounded-2xl text-gray-400 transition-all shadow-sm"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-8 overflow-y-auto space-y-8">
              {/* Calculation Tool */}
              <div className="bg-indigo-50/50 border border-indigo-100 rounded-[24px] p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg">
                      <Timer size={18} />
                    </div>
                    <h3 className="font-black text-indigo-900 uppercase tracking-widest text-xs">Public Holiday Credit Tool</h3>
                  </div>
                  <button 
                    onClick={async () => {
                      if (!confirm("Are you sure you want to reset ALL public balances to 0? This cannot be undone.")) return;
                      setIsSaving(true);
                      try {
                        const updatedEmployees = await Promise.all(employees.map(async (emp) => {
                          const updated = { ...emp, publicBalance: 0 };
                          await store.updateUser(updated);
                          return updated;
                        }));
                        setEmployees(updatedEmployees);
                        alert("All public balances have been reset to 0.");
                      } catch (err) {
                        alert("Error resetting balances");
                      } finally {
                        setIsSaving(false);
                      }
                    }}
                    className="text-[9px] font-black text-rose-400 uppercase tracking-widest hover:text-rose-600 transition-colors"
                  >
                    Reset All to 0
                  </button>
                </div>
                <p className="text-indigo-700/70 text-xs font-medium">
                  Select a date range to calculate public holidays. For each day in this range, 1 day will be added to the Public Balance of all employees.
                </p>
                <div className="flex flex-wrap items-end gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest ml-1">Start Date</label>
                    <input 
                      type="date" 
                      value={balanceCalcStart}
                      onChange={(e) => setBalanceCalcStart(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl bg-white border border-indigo-100 text-sm font-bold outline-none focus:ring-4 focus:ring-indigo-500/10"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest ml-1">End Date</label>
                    <input 
                      type="date" 
                      value={balanceCalcEnd}
                      onChange={(e) => setBalanceCalcEnd(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl bg-white border border-indigo-100 text-sm font-bold outline-none focus:ring-4 focus:ring-indigo-500/10"
                    />
                  </div>
                  <div className="flex-1 min-w-[120px] pb-1">
                    <div className="bg-white/80 border border-indigo-100 rounded-xl px-4 py-2 flex flex-col justify-center">
                      <span className="text-[8px] font-black text-indigo-300 uppercase tracking-widest">Egyptian Holidays</span>
                      <span className="text-lg font-black text-indigo-600 leading-tight">{holidaysInCalcRange.length} Days</span>
                    </div>
                  </div>
                  <button 
                    onClick={async () => {
                      if (holidaysInCalcRange.length === 0) {
                        alert('No public holidays found in the selected range. Please add public holidays to the list below first.');
                        return;
                      }
                      
                      const daysCount = holidaysInCalcRange.length;
                      const choice = confirm(`Found ${daysCount} holidays. \n\nClick OK to ADD ${daysCount} days to current balances. \nClick CANCEL to SET all balances to EXACTLY ${daysCount} days.`);
                      
                      setIsSaving(true);
                      try {
                        const updatedEmployees = await Promise.all(employees.map(async (emp) => {
                          const newBalance = choice ? (emp.publicBalance || 0) + daysCount : daysCount;
                          const updated = { ...emp, publicBalance: newBalance };
                          await store.updateUser(updated);
                          return updated;
                        }));
                        setEmployees(updatedEmployees);
                        alert(`Successfully ${choice ? 'added' : 'set'} ${daysCount} days to everyone's public balance.`);
                      } catch (err) {
                        alert('Error updating balances');
                      } finally {
                        setIsSaving(false);
                      }
                    }}
                    disabled={isSaving || holidaysInCalcRange.length === 0}
                    className="px-8 py-2.5 bg-indigo-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 disabled:opacity-50"
                  >
                    Update All Balances
                  </button>
                </div>
              </div>

              {/* Annual Leave Management Tool */}
              <div className="bg-emerald-50/50 border border-emerald-100 rounded-[24px] p-6 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-emerald-100 text-emerald-600 rounded-lg">
                    <Palmtree size={18} />
                  </div>
                  <h3 className="font-black text-emerald-900 uppercase tracking-widest text-xs">Annual Leave Management Tool</h3>
                </div>
                <p className="text-emerald-700/70 text-xs font-medium">
                  Update the annual leave balance for all employees at once. You can either add days to current balances or set them to a specific value.
                </p>
                <div className="flex items-end gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-emerald-400 uppercase tracking-widest ml-1">Days</label>
                    <input 
                      type="number" 
                      step="0.25"
                      defaultValue="21"
                      id="annualUpdateAmount"
                      className="w-32 px-4 py-2.5 rounded-xl bg-white border border-emerald-100 text-sm font-bold outline-none focus:ring-4 focus:ring-emerald-500/10"
                    />
                  </div>
                  <button 
                    onClick={async () => {
                      const amount = parseFloat((document.getElementById('annualUpdateAmount') as HTMLInputElement).value) || 0;
                      if (amount < 0) return;
                      
                      const choice = confirm(`Update Annual Balance for ALL employees with ${amount} days. \n\nClick OK to ADD ${amount} days to current balances. \nClick CANCEL to SET all balances to EXACTLY ${amount} days.`);

                      setIsSaving(true);
                      try {
                        const updatedEmployees = await Promise.all(employees.map(async (emp) => {
                          const newBalance = choice ? (emp.annualBalance || 0) + amount : amount;
                          const updated = { ...emp, annualBalance: newBalance };
                          await store.updateUser(updated);
                          return updated;
                        }));
                        setEmployees(updatedEmployees);
                        alert(`Successfully ${choice ? 'added' : 'set'} ${amount} days to everyone's annual balance.`);
                      } catch (err) {
                        alert('Error updating balances');
                      } finally {
                        setIsSaving(false);
                      }
                    }}
                    disabled={isSaving}
                    className="px-8 py-2.5 bg-emerald-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100 disabled:opacity-50"
                  >
                    Update All Annual Balances
                  </button>
                </div>
              </div>

              {/* Balance Table */}
              <div className="border border-gray-100 rounded-[24px] overflow-hidden bg-white shadow-sm">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50/50 border-b border-gray-100">
                      <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Employee</th>
                      <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Annual Balance</th>
                      <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Public Balance</th>
                      <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filteredEmployees.map(emp => (
                      <tr key={emp.id} className="hover:bg-gray-50/30 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <Avatar
                              name={emp.name}
                              photoUrl={emp.photoUrl}
                              className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-black text-xs overflow-hidden"
                            />
                            <div>
                              <p className="text-sm font-bold text-gray-900">{emp.name}</p>
                              <p className="text-[10px] font-medium text-gray-400">{emp.jobTitle}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <Palmtree size={14} className="text-emerald-500" />
                            <input 
                              type="number"
                              value={emp.annualBalance || 0}
                              onChange={async (e) => {
                                const val = parseInt(e.target.value) || 0;
                                const updated = { ...emp, annualBalance: val };
                                setEmployees(prev => prev.map(e => e.id === emp.id ? updated : e));
                                await store.updateUser(updated);
                              }}
                              className="w-16 bg-transparent border-none text-sm font-black text-gray-700 focus:ring-0 p-0"
                            />
                            <span className="text-[10px] font-bold text-gray-400">Days</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <Star size={14} className="text-orange-500" />
                            <input 
                              type="number"
                              value={emp.publicBalance || 0}
                              onChange={async (e) => {
                                const val = parseInt(e.target.value) || 0;
                                const updated = { ...emp, publicBalance: val };
                                setEmployees(prev => prev.map(e => e.id === emp.id ? updated : e));
                                await store.updateUser(updated);
                              }}
                              className="w-16 bg-transparent border-none text-sm font-black text-gray-700 focus:ring-0 p-0"
                            />
                            <span className="text-[10px] font-bold text-gray-400">Days</span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <button 
                            onClick={async () => {
                              const newAnnual = prompt('Enter new Annual Balance:', (emp.annualBalance || 0).toString());
                              const newPublic = prompt('Enter new Public Balance:', (emp.publicBalance || 0).toString());
                              
                              if (newAnnual !== null || newPublic !== null) {
                                const updated = { 
                                  ...emp, 
                                  annualBalance: newAnnual !== null ? parseInt(newAnnual) : emp.annualBalance,
                                  publicBalance: newPublic !== null ? parseInt(newPublic) : emp.publicBalance
                                };
                                await store.updateUser(updated);
                                setEmployees(prev => prev.map(e => e.id === emp.id ? updated : e));
                              }
                            }}
                            className="p-2 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-blue-600 transition-all"
                          >
                            <Plus size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
