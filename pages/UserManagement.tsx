
import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../App';
import { useLanguage } from '../i18n';
import { store } from '../store';
import { User, UserRole, isBranchRole, roleLabel, unitOf } from '../types';
import { BRANDS, BRAND_NAMES } from '../brands';
import Avatar from '../Avatar';
import { UserPlus, Search, Edit2, Trash2, X, Fingerprint, ShieldCheck } from 'lucide-react';

const DEPARTMENTS = ['Call Center', 'Technical', 'Complain', 'Quality'];

// Jobs a branch employee can hold inside a branch (stored in jobTitle).
const BRANCH_JOBS = [
  'BAKERY', 'ASSEMBLY', 'SHAWARMA MAKER', 'CASHIER',
  'RESTAURANT SUPERVISOR', 'GRILL MASTER', 'GRILL ASSISTANT', 'TEAM LEADER',
];

export default function UserManagement() {
  const { user: currentUser } = useAuth();
  const { t } = useLanguage();
  // Branch/Area/Operation managers get a scoped User Management: they can
  // only create/edit/delete the roles directly below them — inside their own
  // brand for a Branch/Area Manager, or inside any of their assigned brands
  // (every branch included) for an Operation Manager.
  const isBranchManagerViewer = currentUser?.role === UserRole.BRANCH_MANAGER;
  const isAreaManagerViewer = currentUser?.role === UserRole.AREA_MANAGER;
  const isOperationManagerViewer = currentUser?.role === UserRole.OPERATION_MANAGER;
  const isBranchAcctManager = isBranchManagerViewer || isAreaManagerViewer || isOperationManagerViewer;
  const [users, setUsers] = useState<User[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    name: '',
    username: '',
    password: '',
    role: UserRole.EMPLOYEE,
    jobTitle: '',
    employeeId: '',
    companyName: '',
    managerName: '',
    teamLeader: '',
    brand: '',
    branch: '',
    branches: [] as string[],
    brands: [] as string[],
    phone: '',
    adminOnly: false,
    disabled: false
  });

  // Dropdown options built from existing users.
  const distinct = (vals: (string | undefined)[]) =>
    Array.from(new Set(vals.map(v => (v || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const companyOptions = useMemo(() => distinct(users.map(u => u.companyName)), [users]);
  const managerOptions = useMemo(
    () => distinct(users.filter(u => u.role === UserRole.MANAGER || u.role === UserRole.SUPERVISOR).map(u => u.name)),
    [users]
  );

  useEffect(() => {
    refreshUsers();
  }, [currentUser]);

  const refreshUsers = async () => {
    const all = await store.getUsers();
    let filtered = all;
    
    if (currentUser?.role === UserRole.MANAGER) {
      filtered = all.filter(u => u.companyName === currentUser.companyName);
    }
    
    setUsers(filtered);
  };

  const handleOpenAdd = () => {
    setEditingUserId(null);
    setFormData({
      name: '',
      username: '',
      password: '',
      role: isBranchAcctManager ? UserRole.BRANCH_EMPLOYEE : UserRole.EMPLOYEE,
      jobTitle: '',
      employeeId: '',
      companyName: currentUser?.role === UserRole.SUPERVISOR ? '' : (currentUser?.companyName || 'Swipr'),
      managerName: currentUser?.name || '',
      teamLeader: '',
      // Branch/Area managers create accounts inside their own brand; branch
      // managers' single branch is fixed too (area managers pick from theirs).
      brand: isBranchAcctManager ? (currentUser?.brand || '') : '',
      branch: isBranchManagerViewer ? (currentUser?.branch || '') : '',
      branches: [],
      brands: [],
      phone: '',
      adminOnly: false,
      disabled: false
    });
    setShowModal(true);
  };

  const handleOpenEdit = (user: User) => {
    setEditingUserId(user.id);
    setFormData({
      name: user.name,
      username: user.username,
      password: user.password || '',
      role: user.role,
      jobTitle: user.jobTitle || '',
      employeeId: user.employeeId || '',
      companyName: user.companyName || '',
      managerName: user.managerName || '',
      teamLeader: user.teamLeader || '',
      brand: user.brand || '',
      branch: user.branch || '',
      branches: user.branches || [],
      brands: user.brands || [],
      phone: user.phone || '',
      adminOnly: !!user.adminOnly,
      disabled: !!user.disabled
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const role = formData.role;
    const branchSide = isBranchRole(role);
    // Guard the multi-selects (HTML "required" doesn't cover checkbox groups).
    if (role === UserRole.AREA_MANAGER && formData.branches.length === 0) {
      alert('Select at least one branch for the Area Manager.');
      return;
    }
    if (role === UserRole.OPERATION_MANAGER && formData.brands.length === 0) {
      alert('Select at least one brand for the Operation Manager.');
      return;
    }
    // Only an admin sends these flags; the server drops them from anyone else.
    const { adminOnly, disabled, ...rest } = formData;
    const trimmedData = {
      ...rest,
      ...(currentUser?.role === UserRole.ADMIN ? { adminOnly, disabled } : {}),
      name: formData.name.trim(),
      username: formData.username.trim(),
      jobTitle: formData.jobTitle.trim(),
      // Admins are global; branch roles carry brand/branch instead of a department.
      companyName: role === UserRole.ADMIN || branchSide ? '' : formData.companyName.trim(),
      managerName: branchSide ? '' : formData.managerName,
      // Team Leader only applies to employees.
      teamLeader: role === UserRole.EMPLOYEE ? formData.teamLeader.trim() : '',
      // Brand/branch assignment per role.
      brand: [UserRole.BRANCH_EMPLOYEE, UserRole.BRANCH_MANAGER, UserRole.AREA_MANAGER].includes(role) ? formData.brand : '',
      branch: [UserRole.BRANCH_EMPLOYEE, UserRole.BRANCH_MANAGER].includes(role) ? formData.branch : '',
      branches: role === UserRole.AREA_MANAGER ? formData.branches : [],
      brands: role === UserRole.OPERATION_MANAGER ? formData.brands : [],
      // Phone applies to branch employees and area managers.
      phone: [UserRole.BRANCH_EMPLOYEE, UserRole.AREA_MANAGER].includes(role) ? formData.phone.trim() : ''
    };
    if (editingUserId) {
      await store.updateUser({ id: editingUserId, ...trimmedData });
    } else {
      await store.addUser({ id: Math.random().toString(36).substr(2, 9), ...trimmedData });
    }
    await refreshUsers();
    setShowModal(false);
  };

  const isBranch = isBranchRole(formData.role);
  const toggleIn = (list: string[], v: string) =>
    list.includes(v) ? list.filter(x => x !== v) : [...list, v];

  const filteredUsers = users.filter(u => 
    u.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    u.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.employeeId?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.companyName?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const inputClass = "w-full px-5 py-3.5 rounded-2xl bg-gray-900 border border-gray-800 text-white text-sm font-medium outline-none focus:ring-4 focus:ring-blue-500/10 placeholder:text-gray-600 transition-all";

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">{t('users.title')}</h1>
            {currentUser?.role === UserRole.SUPERVISOR && (
              <span className="flex items-center gap-1.5 px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-[10px] font-black uppercase tracking-widest border border-purple-200">
                <ShieldCheck size={12} />
                Supervisor Access
              </span>
            )}
            {isBranchAcctManager && (
              <span className="flex items-center gap-1.5 px-3 py-1 bg-emerald-100 text-emerald-700 rounded-full text-[10px] font-black uppercase tracking-widest border border-emerald-200">
                <ShieldCheck size={12} />
                {isOperationManagerViewer
                  ? `${roleLabel(currentUser?.role)} · ${(currentUser?.brands || []).length} brand${(currentUser?.brands || []).length === 1 ? '' : 's'}`
                  : <>
                      {roleLabel(currentUser?.role)} · {currentUser?.brand}
                      {isAreaManagerViewer ? ` (${(currentUser?.branches || []).length} branches)` : ` · ${currentUser?.branch}`}
                    </>
                }
              </span>
            )}
          </div>
          <p className="text-gray-500 text-sm">{t('users.subtitle')}</p>
        </div>
        <button 
          onClick={handleOpenAdd}
          className="bg-[#2563EB] text-white px-5 py-2.5 rounded-lg font-bold shadow-sm hover:bg-blue-700 flex items-center space-x-2 transition-all"
        >
          <UserPlus size={18} />
          <span>{t('users.addNew')}</span>
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-100 bg-gray-50 flex items-center">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input 
              type="text" 
              placeholder={t('users.search')} 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-200 text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white shadow-sm"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-gray-50 text-[10px] font-bold uppercase text-gray-400 tracking-wider border-b border-gray-100">
                <th className="px-6 py-4">ID</th>
                <th className="px-6 py-4">Employee</th>
                <th className="px-6 py-4">Details</th>
                <th className="px-6 py-4">Company</th>
                <th className="px-6 py-4">Role</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-sm">
              {filteredUsers.map(u => (
                <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-4">
                    <span className="font-mono text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded border border-blue-100">
                      {u.employeeId || 'N/A'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center space-x-3">
                      <Avatar
                        name={u.name}
                        photoUrl={u.photoUrl}
                        className={`w-9 h-9 rounded-full flex items-center justify-center font-bold border overflow-hidden ${u.role === UserRole.SUPERVISOR ? 'bg-purple-50 text-purple-600 border-purple-100' : 'bg-blue-50 text-blue-600 border-blue-100'}`}
                      />
                      <div>
                        <p className="font-bold text-gray-900">
                          {u.name}
                          {u.disabled && <span className="ml-2 align-middle text-[10px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded bg-rose-50 text-rose-600 border border-rose-100">Deactivated</span>}
                          {u.adminOnly && <span className="ml-2 align-middle text-[10px] font-black uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 border border-gray-200">Admin only</span>}
                        </p>
                        <p className="text-xs text-gray-400">@{u.username}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-gray-600 font-medium">{u.jobTitle || 'No Title'}</p>
                    <p className="text-[10px] text-gray-400 uppercase font-bold tracking-tight">
                      {u.phone ? <>Phone: {u.phone}</> : <>Manager: {u.managerName || 'System'}</>}
                    </p>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-gray-500 font-medium">
                      {u.role === UserRole.ADMIN ? 'All Departments' : (unitOf(u) || '—')}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-widest ${
                      u.role === UserRole.SUPERVISOR ? 'bg-purple-50 text-purple-700' :
                      u.role === UserRole.MANAGER ? 'bg-blue-50 text-blue-700' :
                      isBranchRole(u.role) ? 'bg-emerald-50 text-emerald-700' :
                      'bg-gray-100 text-gray-600'
                    }`}>
                      {roleLabel(u.role)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end space-x-1">
                      <button onClick={() => handleOpenEdit(u)} className="p-1.5 text-gray-400 hover:text-blue-600 rounded-md hover:bg-blue-50 transition-colors">
                        <Edit2 size={16} />
                      </button>
                      <button onClick={async () => { if(confirm('Delete user?')) { await store.deleteUser(u.id); await refreshUsers(); } }} className="p-1.5 text-gray-400 hover:text-red-600 rounded-md hover:bg-red-50 transition-colors">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-md">
          <div className="bg-white rounded-[32px] shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in duration-200">
            <div className="px-8 py-6 flex justify-between items-center border-b border-gray-50">
              <h2 className="text-xl font-black text-gray-900 tracking-tight">
                {editingUserId ? 'Edit Account' : 'Create Account'}
              </h2>
              <button onClick={() => setShowModal(false)} className="p-2 hover:bg-gray-50 rounded-xl text-gray-400 transition-colors">
                <X size={24} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-8 space-y-6">
              <div className="grid grid-cols-2 gap-x-6 gap-y-6">
                <div className="col-span-2">
                   <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 ml-1">Role</label>
                   {isBranchManagerViewer ? (
                     // Branch Managers may only add Branch Employees — nothing to choose.
                     <div className={`${inputClass} flex items-center gap-2 text-gray-400 select-none cursor-not-allowed`}>
                       <ShieldCheck size={16} className="text-emerald-400 shrink-0" />
                       Branch Employee
                     </div>
                   ) : (
                     <select
                      value={formData.role}
                      onChange={e => {
                        const role = e.target.value as UserRole;
                        setFormData({
                          ...formData,
                          role,
                          // Admins are global; branch roles carry brand/branch instead of a department.
                          ...((role === UserRole.ADMIN || isBranchRole(role)) ? { companyName: '' } : {}),
                          // Reset assignment fields that don't apply to the new role.
                          ...(!isBranchRole(role) ? { brand: '', branch: '', branches: [], brands: [] } : {}),
                          ...(role === UserRole.OPERATION_MANAGER ? { brand: '', branch: '', branches: [] } : {}),
                          ...(role === UserRole.AREA_MANAGER ? { branch: '' } : {}),
                          ...([UserRole.BRANCH_EMPLOYEE, UserRole.BRANCH_MANAGER].includes(role) ? { branches: [], brands: [] } : {}),
                        });
                      }}
                      className={`${inputClass} appearance-none cursor-pointer`}
                     >
                       {isAreaManagerViewer ? (
                         <>
                           <option value={UserRole.BRANCH_EMPLOYEE}>Branch Employee</option>
                           <option value={UserRole.BRANCH_MANAGER}>Branch Manager</option>
                         </>
                       ) : isOperationManagerViewer ? (
                         <>
                           <option value={UserRole.BRANCH_EMPLOYEE}>Branch Employee</option>
                           <option value={UserRole.BRANCH_MANAGER}>Branch Manager</option>
                           <option value={UserRole.AREA_MANAGER}>Area Manager</option>
                         </>
                       ) : (
                         <>
                           <option value={UserRole.EMPLOYEE}>Employee</option>
                           <option value={UserRole.MANAGER}>Team Leader</option>
                           <option value={UserRole.SUPERVISOR}>Supervisor</option>
                         </>
                       )}
                       {currentUser?.role === UserRole.ADMIN && (
                         <>
                           <option value={UserRole.ADMIN}>Admin</option>
                           <option value={UserRole.BRANCH_EMPLOYEE}>Branch Employee</option>
                           <option value={UserRole.BRANCH_MANAGER}>Branch Manager</option>
                           <option value={UserRole.AREA_MANAGER}>Area Manager</option>
                           <option value={UserRole.OPERATION_MANAGER}>Operation Manager</option>
                         </>
                       )}
                     </select>
                   )}
                </div>
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 ml-1">Full Name</label>
                  <input 
                    type="text" required placeholder="John Doe"
                    value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })}
                    className={inputClass}
                  />
                </div>
                {!isBranch && (
                  <div>
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 ml-1">Department</label>
                    {formData.role === UserRole.ADMIN ? (
                      // Admins are global — they control every department.
                      <div className={`${inputClass} flex items-center gap-2 text-gray-400 select-none cursor-not-allowed`}>
                        <ShieldCheck size={16} className="text-purple-400 shrink-0" />
                        All departments (global access)
                      </div>
                    ) : (
                      <select
                        required
                        value={formData.companyName} onChange={e => setFormData({ ...formData, companyName: e.target.value })}
                        className={`${inputClass} appearance-none cursor-pointer`}
                      >
                        <option value="">Select department</option>
                        {(currentUser?.role === UserRole.ADMIN ? DEPARTMENTS : [currentUser?.companyName].filter(Boolean) as string[]).map(d => (
                          <option key={d} value={d}>{d}</option>
                        ))}
                      </select>
                    )}
                  </div>
                )}
                {!isBranch && (
                  <div>
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 ml-1">Manager Name</label>
                    <input
                      type="text" list="managerOptions" placeholder="Select or type…"
                      value={formData.managerName} onChange={e => setFormData({ ...formData, managerName: e.target.value })}
                      className={inputClass}
                    />
                    <datalist id="managerOptions">
                      {managerOptions.map(o => <option key={o} value={o} />)}
                    </datalist>
                  </div>
                )}
                {[UserRole.BRANCH_EMPLOYEE, UserRole.BRANCH_MANAGER, UserRole.AREA_MANAGER].includes(formData.role) && (
                  <div>
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 ml-1">Brand</label>
                    {isOperationManagerViewer ? (
                      // Operation Managers own several brands — pick which one, restricted to their own list.
                      <select
                        required
                        value={formData.brand}
                        onChange={e => setFormData({ ...formData, brand: e.target.value, branch: '', branches: [] })}
                        className={`${inputClass} appearance-none cursor-pointer`}
                      >
                        <option value="">Select brand</option>
                        {(currentUser?.brands || []).map(b => <option key={b} value={b}>{b}</option>)}
                      </select>
                    ) : isBranchAcctManager ? (
                      // Branch/Area managers can only add within their own single brand.
                      <div className={`${inputClass} flex items-center gap-2 text-gray-400 select-none cursor-not-allowed`}>
                        <ShieldCheck size={16} className="text-emerald-400 shrink-0" />
                        {formData.brand || '—'}
                      </div>
                    ) : (
                      <select
                        required
                        value={formData.brand}
                        onChange={e => setFormData({ ...formData, brand: e.target.value, branch: '', branches: [] })}
                        className={`${inputClass} appearance-none cursor-pointer`}
                      >
                        <option value="">Select brand</option>
                        {BRAND_NAMES.map(b => <option key={b} value={b}>{b}</option>)}
                      </select>
                    )}
                  </div>
                )}
                {[UserRole.BRANCH_EMPLOYEE, UserRole.BRANCH_MANAGER].includes(formData.role) && (
                  <div>
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 ml-1">Branch</label>
                    {isBranchManagerViewer ? (
                      // Branch Managers can only add to their own branch.
                      <div className={`${inputClass} flex items-center gap-2 text-gray-400 select-none cursor-not-allowed`}>
                        <ShieldCheck size={16} className="text-emerald-400 shrink-0" />
                        {formData.branch || '—'}
                      </div>
                    ) : (
                      <select
                        required disabled={!formData.brand}
                        value={formData.branch}
                        onChange={e => setFormData({ ...formData, branch: e.target.value })}
                        className={`${inputClass} appearance-none cursor-pointer disabled:opacity-50`}
                      >
                        <option value="">{formData.brand ? 'Select branch' : 'Select a brand first'}</option>
                        {/* Area managers may only assign within their own branches. */}
                        {(isAreaManagerViewer ? (currentUser?.branches || []) : (BRANDS[formData.brand] || [])).map(b => <option key={b} value={b}>{b}</option>)}
                      </select>
                    )}
                  </div>
                )}
                {formData.role === UserRole.BRANCH_EMPLOYEE && (
                  <div>
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 ml-1">Job in Branch</label>
                    <select
                      required
                      value={formData.jobTitle}
                      onChange={e => setFormData({ ...formData, jobTitle: e.target.value })}
                      className={`${inputClass} appearance-none cursor-pointer`}
                    >
                      <option value="">Select job</option>
                      {BRANCH_JOBS.map(j => <option key={j} value={j}>{j}</option>)}
                    </select>
                  </div>
                )}
                {[UserRole.BRANCH_EMPLOYEE, UserRole.AREA_MANAGER].includes(formData.role) && (
                  <div>
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 ml-1">Phone Number</label>
                    <input
                      type="tel" placeholder="e.g. 99887766"
                      value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })}
                      className={inputClass}
                    />
                  </div>
                )}
                {formData.role === UserRole.AREA_MANAGER && (
                  <div className="col-span-2">
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 ml-1">
                      Branches (Multi Select){formData.branches.length > 0 && <span className="text-blue-500"> — {formData.branches.length} selected</span>}
                    </label>
                    {formData.brand ? (
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-44 overflow-y-auto p-4 bg-gray-900 border border-gray-800 rounded-2xl">
                        {(BRANDS[formData.brand] || []).map(b => (
                          <label key={b} className="flex items-center gap-2 text-white text-xs font-bold cursor-pointer hover:text-blue-400 transition-colors">
                            <input
                              type="checkbox" className="accent-blue-600"
                              checked={formData.branches.includes(b)}
                              onChange={() => setFormData({ ...formData, branches: toggleIn(formData.branches, b) })}
                            />
                            {b}
                          </label>
                        ))}
                      </div>
                    ) : (
                      <p className={`${inputClass} text-gray-500 select-none`}>Select a brand first.</p>
                    )}
                  </div>
                )}
                {formData.role === UserRole.OPERATION_MANAGER && (
                  <div className="col-span-2">
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 ml-1">
                      Brands (Multi Select) — every branch inside is included
                      {formData.brands.length > 0 && <span className="text-blue-500"> — {formData.brands.length} selected</span>}
                    </label>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 p-4 bg-gray-900 border border-gray-800 rounded-2xl">
                      {BRAND_NAMES.map(b => (
                        <label key={b} className="flex items-center gap-2 text-white text-xs font-bold cursor-pointer hover:text-blue-400 transition-colors">
                          <input
                            type="checkbox" className="accent-blue-600"
                            checked={formData.brands.includes(b)}
                            onChange={() => setFormData({ ...formData, brands: toggleIn(formData.brands, b) })}
                          />
                          {b} <span className="text-gray-500 font-medium">({BRANDS[b].length})</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 ml-1">Username</label>
                  <input 
                    type="text" required placeholder="jdoe"
                    value={formData.username} onChange={e => setFormData({ ...formData, username: e.target.value })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 ml-1">Password</label>
                  <input
                    type="text" required={!editingUserId}
                    placeholder={editingUserId ? 'Leave blank to keep current' : 'Enter password'}
                    value={formData.password} onChange={e => setFormData({ ...formData, password: e.target.value })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 ml-1">Employee ID (Unique)</label>
                  <div className="relative">
                    <Fingerprint className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <input 
                      type="text" required placeholder="EMP-001"
                      value={formData.employeeId} onChange={e => setFormData({ ...formData, employeeId: e.target.value })}
                      className={`${inputClass} pl-12`}
                    />
                  </div>
                </div>
                {formData.role === UserRole.EMPLOYEE && (
                  <div>
                    <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 ml-1">Team Leader</label>
                    <input
                      type="text" list="teamLeaderOptions" placeholder="Select or type…"
                      value={formData.teamLeader} onChange={e => setFormData({ ...formData, teamLeader: e.target.value })}
                      className={inputClass}
                    />
                    <datalist id="teamLeaderOptions">
                      {managerOptions.map(o => <option key={o} value={o} />)}
                    </datalist>
                  </div>
                )}
              </div>
              {currentUser?.role === UserRole.ADMIN && (
                <label className="mt-6 flex items-start gap-3 p-4 rounded-2xl border border-gray-100 bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox" className="mt-1 w-4 h-4 accent-blue-600"
                    checked={formData.adminOnly} onChange={e => setFormData({ ...formData, adminOnly: e.target.checked })}
                  />
                  <span>
                    <span className="block text-sm font-bold text-gray-900">Visible to admins only</span>
                    <span className="block text-xs text-gray-500 mt-0.5">Hides this person and their schedule, breaks, requests, attendance and call figures from everyone except admins. They still see their own.</span>
                  </span>
                </label>
              )}
              {currentUser?.role === UserRole.ADMIN && editingUserId && editingUserId !== currentUser.id && (
                <label className={`mt-3 flex items-start gap-3 p-4 rounded-2xl border cursor-pointer ${formData.disabled ? 'border-rose-200 bg-rose-50' : 'border-gray-100 bg-gray-50'}`}>
                  <input
                    type="checkbox" className="mt-1 w-4 h-4 accent-rose-600"
                    checked={formData.disabled} onChange={e => setFormData({ ...formData, disabled: e.target.checked })}
                  />
                  <span>
                    <span className={`block text-sm font-bold ${formData.disabled ? 'text-rose-700' : 'text-gray-900'}`}>Deactivate account</span>
                    <span className="block text-xs text-gray-500 mt-0.5">They are signed out within seconds and can't sign in again until you untick this. Their schedule and history stay as they are.</span>
                  </span>
                </label>
              )}
              <div className="flex justify-end pt-6">
                <button type="submit" className="bg-[#2563EB] text-white px-12 py-4 rounded-2xl font-black text-sm uppercase tracking-widest shadow-xl shadow-blue-200 hover:bg-blue-700 transition-all active:scale-95">
                  {editingUserId ? 'Save Changes' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
