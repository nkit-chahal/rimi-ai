import React, { createContext, useContext } from 'react';

const ProjectContext = createContext(null);

export function ProjectProvider({ activeProject, projects, setActiveProjectId, children }) {
  return (
    <ProjectContext.Provider value={{ activeProject, projects, setActiveProjectId }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject() {
  return useContext(ProjectContext);
}

export default ProjectContext;
