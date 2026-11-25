import React from "react";
import Header from "./components/Header.jsx";
import AuthScreen from "./components/AuthScreen.jsx";
import Dashboard from "./components/Dashboard.jsx";
import CreateProjectDialog from "./components/CreateProjectDialog.jsx";
import Editor from "./components/Editor.jsx";
import { useSpokeStudio } from "./hooks/useSpokeStudio.js";

export default function App() {
  useSpokeStudio();

  return (
    <>
      <Header />
      <AuthScreen />
      <Dashboard />
      <CreateProjectDialog />
      <Editor />
    </>
  );
}
