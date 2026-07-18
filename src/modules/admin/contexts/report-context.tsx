"use client"
import React, { createContext, useContext } from "react"

const mockReportsData = {
  reports: [],
  revenueData: [
    { name: "Jan", total: 15000 },
    { name: "Feb", total: 35000 },
    { name: "Mar", total: 55000 }
  ],
  bookingStats: { total: 20, confirmed: 15, pending: 5 }
}

const ReportsContext = createContext<any>(mockReportsData)

export const ReportsProvider = ({ children }: { children: React.ReactNode }) => {
  return <ReportsContext.Provider value={mockReportsData}>{children}</ReportsContext.Provider>
}

export const useReports = () => useContext(ReportsContext)