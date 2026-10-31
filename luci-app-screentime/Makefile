include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI support for Screen Time & Parental Controls
LUCI_DEPENDS:=+conntrack
LUCI_PKGARCH:=all

PKG_NAME:=luci-app-screentime
PKG_VERSION:=1.1.0 # x-release-please-version
PKG_RELEASE:=1
PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=Cason Adams <https://github.com/casonadams>

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
