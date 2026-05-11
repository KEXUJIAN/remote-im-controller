#!/bin/bash
set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 进程名（与 ecosystem.config.cjs 一致）
APP_NAME="remote-im-controller"

# 打印函数
print_error() {
    echo -e "${RED}错误: $1${NC}"
}

print_success() {
    echo -e "${GREEN}$1${NC}"
}

print_info() {
    echo -e "${YELLOW}$1${NC}"
}

# 检查 PM2 是否安装
check_pm2() {
    if ! command -v pm2 &> /dev/null; then
        print_error "PM2 未安装"
        echo "请运行: npm install -g pm2"
        exit 1
    fi
}

# 检查进程是否已存在
check_process_exists() {
    if pm2 describe "$APP_NAME" &> /dev/null; then
        return 0
    fi
    return 1
}

# 构建项目
build_project() {
    print_info "正在构建项目..."
    if ! npm run build; then
        print_error "构建失败"
        exit 1
    fi
    print_success "构建完成"
}

# 启动进程（生产环境）
start_production() {
    if check_process_exists; then
        print_error "进程已运行，请先 stop 或 delete"
        exit 1
    fi
    
    build_project
    
    print_info "启动生产环境..."
    pm2 start ecosystem.config.cjs
    print_success "启动成功"
    pm2 status
}

# 启动进程（开发环境）
start_development() {
    if check_process_exists; then
        print_error "进程已运行，请先 stop 或 delete"
        exit 1
    fi
    
    build_project
    
    print_info "启动开发环境..."
    pm2 start ecosystem.config.cjs --env development
    print_success "启动成功"
    pm2 status
}

# 停止进程
stop_process() {
    if ! check_process_exists; then
        print_error "进程不存在"
        exit 1
    fi
    
    print_info "停止进程..."
    pm2 stop "$APP_NAME"
    print_success "已停止"
}

# 重启进程
restart_process() {
    if ! check_process_exists; then
        print_error "进程不存在，请先 start"
        exit 1
    fi
    
    build_project
    
    print_info "重启进程..."
    pm2 restart "$APP_NAME"
    print_success "重启成功"
    pm2 status
}

# 查看日志
view_logs() {
    pm2 logs "$APP_NAME"
}

# 查看状态
view_status() {
    pm2 status
}

# 删除进程
delete_process() {
    if ! check_process_exists; then
        print_error "进程不存在"
        exit 1
    fi
    
    print_info "删除进程..."
    pm2 delete "$APP_NAME"
    print_success "已删除"
}

# 交互菜单
show_menu() {
    echo ""
    echo "========================================"
    echo "  PM2 管理菜单 - $APP_NAME"
    echo "========================================"
    echo ""
    
    select choice in "start (production)" "start (development)" "stop" "restart" "logs" "status" "delete" "exit"; do
        case $REPLY in
            1) start_production ;;
            2) start_development ;;
            3) stop_process ;;
            4) restart_process ;;
            5) view_logs ;;
            6) view_status ;;
            7) delete_process ;;
            8) echo "退出"; exit 0 ;;
            *) print_error "无效选项"; show_menu ;;
        esac
        break
    done
}

# 解析命令行参数
parse_args() {
    local env="production"
    
    # 检查 --dev 参数
    for arg in "$@"; do
        if [[ "$arg" == "--dev" ]]; then
            env="development"
        fi
    done
    
    local command="${1:-}"
    
    case "$command" in
        start)
            if [[ "$env" == "development" ]]; then
                start_development
            else
                start_production
            fi
            ;;
        stop)
            stop_process
            ;;
        restart)
            restart_process
            ;;
        logs)
            view_logs
            ;;
        status)
            view_status
            ;;
        delete)
            delete_process
            ;;
        "")
            show_menu
            ;;
        *)
            print_error "未知命令: $command"
            echo "可用命令: start, stop, restart, logs, status, delete"
            echo "选项: --dev (开发环境)"
            exit 1
            ;;
    esac
}

# 主入口
check_pm2
parse_args "$@"
