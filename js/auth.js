/* SHine-K demo portal session — NO real authentication.
 * This is a static prototype: no password is ever requested, transmitted,
 * or stored. The "login" only records a chosen demo role/org in localStorage
 * so the worksite and control-center views can render role context. */
(function (global) {
  'use strict';
  var KEY = 'shinek_demo_session';

  global.SHAuth = {
    login: function (role, org) {
      var s = { role: role, org: org, at: new Date().toISOString() };
      try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
      return s;
    },
    session: function () {
      try { return JSON.parse(localStorage.getItem(KEY) || 'null'); }
      catch (e) { return null; }
    },
    logout: function () {
      try { localStorage.removeItem(KEY); } catch (e) {}
      location.href = 'portal.html';
    },
    require: function (role) {
      var s = this.session();
      if (!s || (role && s.role !== role)) {
        location.href = 'portal.html';
        return null;
      }
      return s;
    }
  };
})(window);
