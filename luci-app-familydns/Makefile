include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI support for Family DNS (per-device AdGuard Home profiles over DoT)
LUCI_DEPENDS:=+adguardhome +acme-acmesh +acme-acmesh-dnsapi +ddns-scripts
LUCI_PKGARCH:=all

PKG_NAME:=luci-app-familydns
PKG_VERSION:=1.0.2 # x-release-please-version
PKG_RELEASE:=1
PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=Cason Adams <https://github.com/casonadams>

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
