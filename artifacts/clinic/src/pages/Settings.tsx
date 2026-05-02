import { useI18n } from "@/hooks/i18n";
import { useAuth } from "@/hooks/auth";
import PageHeader from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Settings as SettingsIcon, Shield, Database, Bell, Globe } from "lucide-react";

export default function Settings() {
  const { t } = useI18n();
  const { user } = useAuth();

  return (
    <div>
      <PageHeader title={t("settings")} subtitle="System configuration" />
      <div className="p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="border border-border">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm flex items-center gap-2"><Shield className="w-4 h-4 text-primary" /> Security</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-3 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Authentication</span>
                <Badge variant="outline" className="text-xs">Username/Password</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">2FA</span>
                <Badge variant="secondary" className="text-xs">Planned</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Session Timeout</span>
                <Badge variant="outline" className="text-xs">8 hours</Badge>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-border">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm flex items-center gap-2"><Database className="w-4 h-4 text-primary" /> Database</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-3 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Type</span>
                <Badge variant="outline" className="text-xs">PostgreSQL</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Backup Strategy</span>
                <Badge variant="outline" className="text-xs">Daily Incremental</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Soft Deletes</span>
                <Badge className="text-xs bg-green-100 text-green-800 border-none">Enabled</Badge>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-border">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm flex items-center gap-2"><Bell className="w-4 h-4 text-primary" /> Notifications</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-3 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Patient Arrival Alerts</span>
                <Badge className="text-xs bg-green-100 text-green-800 border-none">Enabled</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Lab Result Alerts</span>
                <Badge className="text-xs bg-green-100 text-green-800 border-none">Enabled</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Internal Chat</span>
                <Badge variant="secondary" className="text-xs">Excluded</Badge>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-border">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm flex items-center gap-2"><Globe className="w-4 h-4 text-primary" /> Localization</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-3 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Supported Languages</span>
                <Badge variant="outline" className="text-xs">EN / AR</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">RTL Support</span>
                <Badge className="text-xs bg-green-100 text-green-800 border-none">Enabled</Badge>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="border border-border">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm flex items-center gap-2"><SettingsIcon className="w-4 h-4 text-primary" /> Current Session</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div><p className="text-xs text-muted-foreground">User</p><p className="font-medium mt-0.5">{user?.fullName}</p></div>
            <div><p className="text-xs text-muted-foreground">Role</p><p className="font-medium mt-0.5 capitalize">{user?.role?.replace(/_/g, " ")}</p></div>
            <div><p className="text-xs text-muted-foreground">Username</p><p className="font-medium mt-0.5">@{user?.username}</p></div>
            <div><p className="text-xs text-muted-foreground">System Version</p><p className="font-medium mt-0.5">v1.0.0</p></div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
