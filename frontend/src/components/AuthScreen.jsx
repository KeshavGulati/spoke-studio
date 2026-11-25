import React from "react";

function PasswordField({ id }) {
  return (
    <label>
      Workspace password
      <div className="password-field relative flex">
        <input
          id={id}
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        <button
          className="password-toggle"
          type="button"
          data-password-toggle={id}
          aria-label="Show password"
          aria-pressed="false"
          title="Show password"
        />
      </div>
    </label>
  );
}

function RememberSession() {
  return (
    <label className="remember-session">
      <input name="remember" type="checkbox" value="true" />
      Stay logged in for 30 days
    </label>
  );
}

export default function AuthScreen() {
  return (
    <div id="authScreen">
      <div id="authCard">
        <h1>
          <span className="brand-mark" aria-hidden="true" />
          Spoke Studio
        </h1>
        <h2>Identify your annotations</h2>
        <p>
          Use the shared workspace password, your email, and a username. Each
          account receives a permanent ID so image uploads and mask edits can be
          attributed.
        </p>
        <div className="auth-tabs">
          <button id="showLogin" type="button">
            Log in
          </button>
          <button id="showSignup" type="button" className="active">
            Sign up
          </button>
        </div>
        <form id="loginForm" hidden>
          <label>
            Email
            <input
              id="loginEmail"
              name="email"
              type="email"
              maxLength="254"
              autoComplete="email"
              required
            />
          </label>
          <PasswordField id="loginPassword" />
          <RememberSession />
          <button type="submit" className="primary">
            Log in
          </button>
        </form>
        <form id="signupForm">
          <label>
            Email
            <input
              id="signupEmail"
              name="email"
              type="email"
              maxLength="254"
              autoComplete="email"
              required
            />
          </label>
          <label>
            Username
            <input
              id="signupUsername"
              name="username"
              type="text"
              maxLength="40"
              autoComplete="nickname"
              placeholder="Your display name"
              required
            />
          </label>
          <PasswordField id="signupPassword" />
          <RememberSession />
          <button type="submit" className="primary">
            Create account
          </button>
        </form>
        <p id="authError" role="alert" />
      </div>
    </div>
  );
}
