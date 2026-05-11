module.exports = {
  apps: [
    {
      name: 'remote-im-controller',
      script: 'dist/app.js',
      cwd: '/root/workspace/remote-im-controller',
      
      // 进程管理
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      
      // 重启策略
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: '10s',
      
      // 环境变量
      env: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info'
      },
      env_development: {
        NODE_ENV: 'development',
        LOG_LEVEL: 'debug'
      },
      
      // 日志配置
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      merge_logs: true,
      
      // 优雅退出
      kill_timeout: 10000,
      wait_ready: true,
      listen_timeout: 10000
    }
  ]
};
