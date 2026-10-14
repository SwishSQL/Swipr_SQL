
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../App';
import { Lock, User as UserIcon, ShieldCheck } from 'lucide-react';
import { store } from '../store';
import { UserRole } from '../types';
import { getPendingScan } from '../pendingScan';
import { useLanguage } from '../i18n';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [dbEmpty, setDbEmpty] = useState(false);
  const { login } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();

  useEffect(() => {
    const checkSetup = async () => {
      try {
        setDbEmpty(await store.getSetupStatus());
      } catch {
        setDbEmpty(false);
      }
    };
    checkSetup();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    try {
      const success = await login(username, password);
      if (success) {
        // If they got here by scanning the branch QR while logged out,
        // finish that scan instead of dropping them on the dashboard.
        navigate(getPendingScan() ? '/scan' : '/');
      } else {
        setError(t('login.invalidCreds'));
      }
    } catch (err) {
      setError(t('login.connectionError'));
    } finally {
      setIsLoading(false);
    }
  };

  const createFirstAdmin = async () => {
    const supervisorUser = {
      id: 'super-001',
      name: 'Global Supervisor',
      username: 'supervisor',
      password: 'super123',
      role: UserRole.SUPERVISOR,
      companyName: 'Swipr Global',
      employeeId: 'SUPER-01'
    };
    try {
      await store.bootstrapSupervisor(supervisorUser);
      setDbEmpty(false);
      alert('Global Supervisor created!\nUser: supervisor\nPass: super123');
    } catch {
      alert('Setup could not be completed (an account may already exist).');
    }
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-white">
      {/* Left Side: Branding & Info */}
      <div className="md:w-1/2 bg-[#00875A] p-12 md:p-24 flex flex-col justify-center text-white relative overflow-hidden">
        {/* Decorative background circle */}
        <div className="absolute -top-24 -left-24 w-96 h-96 bg-white/5 rounded-full blur-3xl"></div>
        <div className="absolute -bottom-24 -right-24 w-64 h-64 bg-black/10 rounded-full blur-3xl"></div>

        <div className="relative z-10 space-y-8 animate-in fade-in slide-in-from-left duration-700">
          <div className="bg-white p-4 rounded-xl w-fit shadow-2xl">
            <h2 className="text-black font-black text-3xl tracking-tighter">SWIPR</h2>
          </div>
          
          <div className="space-y-4">
            <h1 className="text-5xl md:text-6xl font-black leading-tight tracking-tighter">
              {t('login.heroTitle1')} <br />
              {t('login.heroTitle2')} <br />
              {t('login.heroTitle3')}
            </h1>
            <p className="text-emerald-50/80 font-medium text-lg max-w-md leading-relaxed">
              {t('login.heroDesc')}
            </p>
          </div>
        </div>
      </div>

      {/* Right Side: Login Form */}
      <div className="md:w-1/2 bg-[#F8FAFC] flex flex-col justify-center items-center p-8 md:p-12">
        <div className="w-full max-w-md space-y-8 animate-in fade-in slide-in-from-right duration-700">
          <div className="text-center md:text-left mb-8">
            <h2 className="text-3xl font-black text-[#0F172A] tracking-tight">{t('login.title')}</h2>
            <p className="text-gray-400 font-medium mt-1">{t('login.subtitle')}</p>
          </div>

          <div className="bg-white rounded-[40px] p-10 shadow-2xl shadow-emerald-900/5 border border-white">
            {dbEmpty && (
              <div className="mb-8 p-6 bg-purple-50 border border-purple-100 rounded-[24px]">
                <div className="flex items-center space-x-3 text-purple-700 mb-3">
                  <ShieldCheck size={20} />
                  <span className="font-bold">{t('login.systemSetup')}</span>
                </div>
                <p className="text-xs text-purple-600/80 mb-4 font-medium uppercase tracking-wider">{t('login.noSupervisor')}</p>
                <button
                  onClick={createFirstAdmin}
                  className="w-full py-3.5 bg-purple-600 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-purple-700 transition-all shadow-lg shadow-purple-200"
                >
                  {t('login.createSupervisor')}
                </button>
              </div>
            )}

            {error && (
              <div className="mb-6 p-4 bg-red-50 text-red-600 rounded-2xl text-xs font-black uppercase tracking-widest border border-red-100 animate-bounce">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2.5 ml-1">{t('login.username')}</label>
                <div className="relative">
                  <UserIcon className="absolute left-5 top-1/2 -translate-y-1/2 text-blue-400" size={18} />
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full pl-14 pr-6 py-4 bg-[#EEF2FF]/50 border border-transparent rounded-[20px] focus:ring-4 focus:ring-emerald-500/10 focus:bg-white focus:border-emerald-100 transition-all outline-none font-bold text-gray-900 placeholder:text-gray-300"
                    placeholder="User name"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2.5 ml-1">{t('login.password')}</label>
                <div className="relative">
                  <Lock className="absolute left-5 top-1/2 -translate-y-1/2 text-blue-400" size={18} />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-14 pr-6 py-4 bg-[#EEF2FF]/50 border border-transparent rounded-[20px] focus:ring-4 focus:ring-emerald-500/10 focus:bg-white focus:border-emerald-100 transition-all outline-none font-bold text-gray-900 placeholder:text-gray-300"
                    placeholder="••••••••••••"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-4 bg-[#00875A] hover:bg-[#00704a] text-white font-black rounded-[20px] shadow-xl shadow-emerald-100 transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center text-sm tracking-tight"
              >
                {isLoading ? t('login.authenticating') : t('login.signIn')}
              </button>
            </form>
          </div>

          <p className="text-center text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mt-12">
            © 2026 SWIPR SCHEDULE MANAGEMENT SYSTEM.<br />
            {t('login.rights')}
          </p>
        </div>
      </div>
    </div>
  );
}
